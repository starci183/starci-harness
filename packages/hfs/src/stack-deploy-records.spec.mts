// Spec: the records of a deploy on the manager - the lock shared by every deploy, the journal of every attempt, the skip when the accepted release already
// runs the commit, the rollback target's images pulled in preflight, and `stack status` reporting drift of the live services against the accepted release.
// The lock and journal scripts run for real under sh against a temporary directory; the deploy runs over stubbed collaborators and a recording docker.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';
import { deployRelease, rollbackRelease } from '../stack/deploy.mjs';
import type { DeployDeps } from '../stack/deploy.mjs';
import { refusal } from '../stack/errors.mjs';
import { holdLock, newAttemptId, openAttempt, outcomeOf } from '../stack/journal.mjs';
import { ATTEMPT_ID, LOCK_TTL_SECONDS, createReleaseStore, lockAcquireScript } from '../stack/release-store.mjs';
import type { RemoteResult } from '../stack/remote.mjs';
import { compareWithRelease, observedServices, statusStack } from '../stack/status.mjs';
import type { ObservedService } from '../stack/status.mjs';
import { stackMain } from '../stack/cli.mjs';
import { verifyStack } from '../stack/verify.mjs';
import { recordsDouble } from './stack-records-double.mjs';
import type { RecordsOptions } from './stack-records-double.mjs';

// reason: the stack seams are partial fakes: a context carries only the members the step under test reads.
const contextOf = (seams: object): StackContext => seams as unknown as StackContext;
// reason: the deploy config is the few fields the verbs read, not a full normalised DeployConfig.
const configOf = (fields: object): DeployConfig => fields as unknown as DeployConfig;

const SHA = 'f'.repeat(40);
const OLD_SHA = '1'.repeat(40);
const digest = (char: string) => `sha256:${char.repeat(64)}`;
const NEW_API = `registry.example/shop-api@${digest('e')}`;
const OLD_API = `registry.example/shop-api@${digest('d')}`;
const DB = `postgres@${digest('c')}`;
const stackOf = (api: string) => `services:\n  api:\n    image: ${api}\n  db:\n    image: ${DB}\n`;
const NEW_STACK = stackOf(NEW_API);
const OLD_STACK = stackOf(OLD_API);
const OLD_RELEASE = 'a'.repeat(16);

// ---- the lock and journal scripts, for real ---------------------------------------------------------------------------------------------

/** The manager's base directory as a path the store accepts (POSIX; Git for Windows maps C:\x to /c/x). */
const posixPath = (dir: string) => (process.platform === 'win32' ? dir.replace(/^([A-Za-z]):/u, (_all, drive: string) => `/${drive.toLowerCase()}`).split(path.sep).join('/') : dir);

function manager(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-records-'));
  t.after(() => {
    // a stored release is read-only (chmod 550 / 440), and removing it needs its directory writable
    for (const release of fs.existsSync(path.join(dir, 'releases')) ? fs.readdirSync(path.join(dir, 'releases')) : []) fs.chmodSync(path.join(dir, 'releases', release), 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = posixPath(dir);
  const ssh = (command: string, options: { input?: string | undefined } = {}): RemoteResult => {
    const run = spawnSync('sh', ['-c', command], { input: options.input, encoding: 'utf8', windowsHide: true });
    return { status: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
  };
  const store = () => createReleaseStore({ stack: 'shop', remote: { releasesBase: base } } as unknown as Parameters<typeof createReleaseStore>[0], ssh);
  return { dir, base, store, ssh };
}

const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

test('the deploy lock is taken by one holder at a time, reports its holder to the other and is released by its owner only', async (t) => {
  const { dir, store } = manager(t);
  const first = store();
  const second = store();
  assert.deepEqual(await first.tryLock(TOKEN_A, 'ci'), { acquired: true });
  const busy = await second.tryLock(TOKEN_B, 'urgent');
  assert.equal(busy.acquired, false);
  assert.equal((busy as { holder: string }).holder, 'ci');
  assert.ok((busy as { ageSeconds: number }).ageSeconds < 30);
  assert.equal(await second.unlock(TOKEN_B), false, 'a non-owner releases nothing');
  assert.equal(await second.refreshLock(TOKEN_B), false);
  assert.equal(await first.refreshLock(TOKEN_A), true);
  assert.equal(fs.existsSync(path.join(dir, 'deploy.lock')), true);
  assert.equal(await first.unlock(TOKEN_A), true);
  assert.equal(fs.existsSync(path.join(dir, 'deploy.lock')), false);
  assert.deepEqual(await second.tryLock(TOKEN_B, 'urgent'), { acquired: true });
  assert.match(fs.readFileSync(path.join(dir, 'deploy.lock', 'owner'), 'utf8'), new RegExp(`^${TOKEN_B} urgent [0-9]+\\n$`, 'u'));
});

test('a lock nobody refreshed for the TTL is taken over by exactly one next holder', async (t) => {
  const { dir, store } = manager(t);
  const s = store();
  assert.deepEqual(await s.tryLock(TOKEN_A, 'dispatch'), { acquired: true });
  fs.writeFileSync(path.join(dir, 'deploy.lock', 'owner'), `${TOKEN_A} dispatch ${Math.floor(Date.now() / 1000) - LOCK_TTL_SECONDS - 5}\n`);
  assert.deepEqual(await s.tryLock(TOKEN_B, 'ci'), { acquired: true }, 'the stale lock is moved aside and claimed');
  assert.equal(await s.refreshLock(TOKEN_A), false, 'the old holder learns it lost the lock');
  assert.equal(await s.unlock(TOKEN_A), false);
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes('stale')).length, 0, 'the moved-aside lock is removed');
});

test('a lock without an owner file stays held while its directory is fresh', async (t) => {
  const { dir, store } = manager(t);
  fs.mkdirSync(path.join(dir, 'deploy.lock'));
  const busy = await store().tryLock(TOKEN_A, 'ci');
  assert.equal(busy.acquired, false);
  assert.equal((busy as { holder: string }).holder, 'unknown');
});

test('the lock scripts take only a validated token and trigger', async (t) => {
  const { store } = manager(t);
  await assert.rejects(store().tryLock('x; rm -rf /', 'ci'), (error: { code?: string }) => error.code === 'STACK_LOCK_TOKEN');
  await assert.rejects(store().tryLock(TOKEN_A, 'ci; true' as 'ci'), (error: { code?: string }) => error.code === 'STACK_LOCK_TRIGGER');
  assert.throws(() => lockAcquireScript('/srv/shop', TOKEN_A, 'whoever'), (error: { code?: string }) => error.code === 'STACK_LOCK_TRIGGER');
});

test('the journal keeps one document per attempt, rewritten in place, and an append-only index', async (t) => {
  const { dir, store } = manager(t);
  const id = newAttemptId({ now: () => Date.UTC(2026, 9, 31, 8, 30, 15) });
  assert.match(id, ATTEMPT_ID);
  assert.ok(id.startsWith('20261031T083015Z-'));
  const journal = store().journal(id);
  await journal.write({ attempt: id, outcome: 'running', note: 'quote \' and $(x) and "double"' });
  await journal.write({ attempt: id, outcome: 'accepted' });
  await journal.index({ attempt: id, event: 'start' });
  await journal.index({ attempt: id, event: 'end', outcome: 'accepted' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'deploys', `${id}.json`), 'utf8')), { attempt: id, outcome: 'accepted' });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'deploys')), [`${id}.json`], 'no temporary file is left behind');
  const lines = fs.readFileSync(path.join(dir, 'deploys.jsonl'), 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line) as { event: string });
  assert.deepEqual(lines.map((line) => line.event), ['start', 'end']);
  assert.throws(() => store().journal('../../etc/passwd'), (error: { code?: string }) => error.code === 'STACK_ATTEMPT_ID');
});

test('a stored release reads back into memory, and the records of an unknown release fail', async (t) => {
  const { store } = manager(t);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-records-out-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, 'stack.yaml'), NEW_STACK);
  fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify({ sourceSha: SHA }));
  const s = store();
  await s.store(out, OLD_RELEASE);
  assert.deepEqual(await s.read(OLD_RELEASE), { stackYaml: NEW_STACK, release: { sourceSha: SHA } });
  await assert.rejects(s.read('b'.repeat(16)), (error: { code?: string }) => error.code === 'STACK_RELEASE_SSH');
});

// ---- the attempt, over the in-memory records ----------------------------------------------------------------------------------------------

test('an attempt journals its phases, outcome and the lock, and refuses a manager that cannot keep the journal', async () => {
  const records = recordsDouble();
  let clock = Date.UTC(2026, 9, 31, 9, 0, 0);
  const ctx = contextOf({ env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.3', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/shop' }, now: () => (clock += 1000), sleep: async () => {} });
  const rec = await openAttempt(ctx, configOf({ stack: 'shop', env: 'production' }), records as never, { kind: 'deploy', trigger: 'ci', sourceSha: SHA, ciRun: '4242' });
  await rec.phase('first', () => 1);
  await assert.rejects(rec.phase('second', () => { throw refusal('X_CODE', 'boom'); }), /boom/u);
  await rec.finish('refused', { code: 'X_CODE', message: 'boom' });
  const doc = records.documents.get(rec.id) as { trigger: string; tag: string; ci: { run: string; url: string }; phases: { phase: string; verdict: string; endedAt: string | null }[]; outcome: string; error: { code: string } };
  assert.equal(doc.trigger, 'ci');
  assert.equal(doc.tag, 'v1.2.3');
  assert.deepEqual(doc.ci, { run: '4242', url: 'https://github.com/o/shop/actions/runs/4242' });
  assert.deepEqual(doc.phases.map((p) => [p.phase, p.verdict]), [['first', 'ok'], ['second', 'failed']]);
  assert.ok(doc.phases.every((p) => p.endedAt !== null));
  assert.equal(doc.outcome, 'refused');
  assert.equal(doc.error.code, 'X_CODE');
  assert.ok(records.writes.some((w) => (w.phases as unknown[]).length === 2 && (w.phases as { verdict: string }[])[1]?.verdict === 'running'), 'a cancelled job would have left the running phase');
  assert.deepEqual(records.index.map((line) => line.event), ['start', 'end']);
  await assert.rejects(openAttempt(ctx, configOf({ stack: 'shop', env: 'production' }), recordsDouble({ failJournal: true }) as never, { kind: 'deploy', trigger: 'dispatch' }), (error: { code?: string }) => error.code === 'STACK_DEPLOY_JOURNAL');
});

test('outcomes: already current, pending, accepted, refused before the deploy, rolled back and rollback failed', () => {
  const at = (data: Record<string, unknown>, ok = false) => outcomeOf({ ok, lines: [], data }, 'deploy');
  assert.equal(at({ alreadyCurrent: true }, true), 'already-current');
  assert.equal(at({ pendingAccept: true }, true), 'pending');
  assert.equal(at({}, true), 'accepted');
  assert.equal(at({ steps: [{ step: 'render' }, { step: 'provision' }] }), 'refused');
  assert.equal(at({ steps: [{ step: 'deploy' }], rolledBack: true }), 'rolled-back');
  assert.equal(at({ steps: [{ step: 'deploy' }], rolledBack: false }), 'rollback-failed');
});

test('a held lock is waited for, then taken; a lock held past the wait is the refusal STACK_DEPLOY_LOCKED', async () => {
  let clock = 0;
  const slept: number[] = [];
  const ctx = contextOf({ now: () => clock, sleep: async (ms: number) => { slept.push(ms); clock += ms; } });
  const waiting = recordsDouble({ busy: { holder: 'urgent', ageSeconds: 30, freeAfterTries: 2 } });
  const hold = await holdLock(ctx, waiting as never, 'ci', { waitSeconds: 600, pollSeconds: 10 });
  assert.deepEqual(slept, [10_000, 10_000]);
  assert.equal(await hold.release(), true);
  const stuck = recordsDouble({ busy: { holder: 'dispatch', ageSeconds: 700 } });
  await assert.rejects(holdLock(ctx, stuck as never, 'ci', { waitSeconds: 60, pollSeconds: 20 }), (error: { code?: string; message: string }) => error.code === 'STACK_DEPLOY_LOCKED' && /dispatch/u.test(error.message) && /nothing was changed/u.test(error.message));
  assert.equal(stuck.lock, null);
});

// ---- the deploy over stubbed collaborators ------------------------------------------------------------------------------------------------

interface World { live?: ObservedService[]; pullFails?: string[]; verifyOk?: boolean; provisionThrows?: boolean; records?: RecordsOptions; current?: string; sourceSha?: string }

function inspectOf(live: ObservedService) {
  return { Spec: { TaskTemplate: { ContainerSpec: { Image: live.image } } }, UpdateStatus: live.updateState ? { State: live.updateState } : undefined };
}

const serviceOf = (service: string, image: string, updateState: string | null = 'completed', hash = 'h'.repeat(16)): ObservedService => ({ service, image, digest: image.slice(image.indexOf('@') + 1), updateState, taskTemplateHash: hash });

/** deployRelease over stubs. `order` holds the effects in order, `stored` the release.json at each `store` call. */
async function deploy(t: TestContext, world: World = {}, options: Record<string, unknown> = {}, ctxExtra: object = {}) {
  const out = fs.mkdtempSync(path.join(tempRoot(), 'hfs-records-deploy-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const current = world.current ?? OLD_RELEASE;
  const records = recordsDouble({ read: (id) => (id === current ? { stackYaml: OLD_STACK, release: { sourceSha: world.sourceSha ?? OLD_SHA } } : { stackYaml: NEW_STACK, release: {} }), ...world.records });
  const order: string[] = [];
  const stored: Record<string, unknown>[] = [];
  const pulls: string[] = [];
  const step = (name: string, ok = true) => async () => { order.push(name); return { ok, lines: [] }; };
  const store = {
    current: async () => current,
    previous: async () => '',
    store: async (dir: string) => { order.push('store'); stored.push(JSON.parse(fs.readFileSync(path.join(dir, 'release.json'), 'utf8')) as Record<string, unknown>); },
    accept: async () => { order.push('accept'); },
    fetch: async (_id: string, dir: string) => { order.push('fetch'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'stack.yaml'), OLD_STACK); fs.writeFileSync(path.join(dir, 'release.json'), '{}'); return dir; },
    ...records,
  };
  const live = world.live ?? [serviceOf('api', NEW_API), serviceOf('db', DB)];
  const spawn = (_command: string, args: readonly string[]) => {
    if (args[0] === 'pull') { pulls.push(args[2] as string); return world.pullFails?.includes(args[2] as string) ? { status: 1, stdout: '', stderr: 'manifest unknown' } : { status: 0, stdout: '', stderr: '' }; }
    if (args[0] === 'service' && args[1] === 'ls') return { status: 0, stdout: live.map((entry) => `shop_${entry.service}`).join('\n'), stderr: '' };
    if (args[0] === 'service' && args[1] === 'inspect') { const entry = live.find((one) => `shop_${one.service}` === args[2]); return { status: 0, stdout: JSON.stringify(inspectOf(entry as ObservedService)), stderr: '' }; }
    if (args[0] === 'stack' && args[1] === 'deploy') order.push('stack-deploy');
    return { status: 0, stdout: '', stderr: '' };
  };
  const deps = {
    renderRelease: async (_ctx: unknown, _config: unknown, o: { out: string }) => { order.push('render'); fs.writeFileSync(path.join(o.out, 'stack.yaml'), NEW_STACK); fs.writeFileSync(path.join(o.out, 'release.json'), JSON.stringify({ sourceSha: SHA })); return { ok: true, lines: [] }; },
    provisionRelease: async () => { if (world.provisionThrows) throw refusal('STACK_PROVISION_X', 'the secret is not sealed'); order.push('provision'); return { ok: true, lines: [] }; },
    releaseStore: () => store,
    ssh: async () => ({ cleanup() {} }),
    reconcileEdge: step('edge'), convergeStack: step('converge'), pruneStack: step('prune'),
    verifyStack: step('verify', world.verifyOk !== false),
    postDeployStack: step('post-deploy'),
  } as unknown as Partial<DeployDeps>;
  const config = configOf({ stack: 'shop', env: 'production', ingress: null, tasks: {}, postDeploy: [] });
  const ctx = contextOf({ spawn, env: {}, now: (() => { let clock = Date.UTC(2026, 9, 31, 10, 0, 0); return () => (clock += 1000); })(), sleep: async () => {}, ...ctxExtra });
  const run = () => deployRelease(ctx, config, { sourceSha: SHA, execute: true, out, ...options }, deps);
  return { run, records, order, stored, pulls };
}

const phasesOf = (records: ReturnType<typeof recordsDouble>) => {
  const [doc] = [...records.documents.values()] as { phases: { phase: string; verdict: string }[]; outcome: string; trigger: string; releaseId: string; previous: string; observed: Record<string, unknown[]>; error: { code: string } | null }[];
  return doc as NonNullable<typeof doc>;
};

test('a deploy takes the lock, journals every phase, snapshots the services and accepts', async (t) => {
  const { run, records, order, stored } = await deploy(t);
  const result = await run();
  assert.equal(result.ok, true, result.lines.join('\n'));
  const doc = phasesOf(records);
  assert.deepEqual(doc.phases.map((p) => p.phase), ['lock', 'idempotence', 'render', 'provision', 'store', 'pre-pull', 'deploy', 'edge', 'converge', 'verify', 'accept']);
  assert.ok(doc.phases.every((p) => p.verdict === 'ok'));
  assert.equal(doc.outcome, 'accepted');
  assert.equal(doc.trigger, 'dispatch');
  assert.equal(doc.previous, OLD_RELEASE);
  assert.match(doc.releaseId, /^[0-9a-f]{16}$/u);
  assert.deepEqual(Object.keys(doc.observed).sort(), ['accept', 'converge']);
  assert.equal(doc.observed.accept?.length, 2);
  assert.equal((result.data as { attempt: string }).attempt, [...records.documents.keys()][0]);
  assert.deepEqual(records.index.map((line) => line.event), ['start', 'end']);
  assert.equal(records.lock, null, 'the lock is released');
  assert.equal(records.calls[0], 'try:dispatch');
  assert.equal(records.calls.at(-1), 'unlock');
  assert.ok(records.calls.filter((call) => call === 'refresh').length >= 10, 'every phase refreshes the lock');
  const acceptRecord = stored.at(-1) as { observed: { accept: ObservedService[] } };
  assert.equal(acceptRecord.observed.accept.length, 2, 'the accepted release record carries the services observed at the accept');
  assert.ok(order.indexOf('store') < order.indexOf('stack-deploy') && order.lastIndexOf('store') < order.lastIndexOf('accept'));
});

test('--ci-run makes the attempt a CI one and names the run and the tag', async (t) => {
  const { run, records } = await deploy(t, {}, { ciRun: '777' }, { env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v2.0.0', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/shop' } });
  await run();
  const doc = phasesOf(records) as unknown as { trigger: string; tag: string; ci: { run: string; url: string } };
  assert.equal(doc.trigger, 'ci');
  assert.equal(doc.tag, 'v2.0.0');
  assert.deepEqual(doc.ci, { run: '777', url: 'https://github.com/o/shop/actions/runs/777' });
});

test('a step that throws is journaled failed, the attempt is refused and the lock is released', async (t) => {
  const { run, records, order } = await deploy(t, { provisionThrows: true });
  await assert.rejects(run(), (error: { code?: string }) => error.code === 'STACK_PROVISION_X');
  const doc = phasesOf(records);
  assert.deepEqual(doc.phases.map((p) => [p.phase, p.verdict]), [['lock', 'ok'], ['idempotence', 'ok'], ['render', 'ok'], ['provision', 'failed']]);
  assert.equal(doc.outcome, 'refused');
  assert.equal(doc.error?.code, 'STACK_PROVISION_X');
  assert.equal(records.lock, null);
  assert.ok(!order.includes('stack-deploy'));
});

test('a red verify is journaled with the rollback phases, a snapshot of the rolled-back services and the outcome rolled-back', async (t) => {
  const { run, records } = await deploy(t, { verifyOk: false });
  const result = await run();
  assert.equal(result.ok, false);
  const doc = phasesOf(records);
  assert.equal(doc.outcome, 'rolled-back');
  assert.deepEqual(doc.phases.slice(-5).map((p) => [p.phase, p.verdict]), [['verify', 'failed'], ['rollback-fetch', 'ok'], ['rollback-deploy', 'ok'], ['rollback-edge', 'ok'], ['rollback-converge', 'ok']]);
  assert.deepEqual(Object.keys(doc.observed).sort(), ['converge', 'rollback']);
  assert.equal(records.lock, null);
});

test('a held lock refuses the attempt after the wait with nothing deployed, and the journal says why', async (t) => {
  let clock = 0;
  const { run, records, order } = await deploy(t, { records: { busy: { holder: 'urgent', ageSeconds: 5 } } }, { lockWaitSeconds: 30 }, { now: () => clock, sleep: async (ms: number) => { clock += ms; } });
  await assert.rejects(run(), (error: { code?: string }) => error.code === 'STACK_DEPLOY_LOCKED');
  const doc = phasesOf(records);
  assert.equal(doc.outcome, 'refused');
  assert.equal(doc.error?.code, 'STACK_DEPLOY_LOCKED');
  assert.deepEqual(doc.phases.map((p) => [p.phase, p.verdict]), [['lock', 'failed']]);
  assert.deepEqual(order, ['render'], 'only the local render ran: nothing was provisioned, stored or deployed');
});

test('the accepted release that already runs the commit and matches its services ends the deploy green, touching nothing', async (t) => {
  const { run, records, order } = await deploy(t, { sourceSha: SHA, live: [serviceOf('api', OLD_API), serviceOf('db', DB)] });
  const result = await run();
  assert.equal(result.ok, true);
  assert.match(result.lines.join('\n'), /already current: release a{16} runs commit f{10}/u);
  assert.equal((result.data as { alreadyCurrent: boolean }).alreadyCurrent, true);
  assert.equal(phasesOf(records).outcome, 'already-current');
  assert.ok(!order.includes('stack-deploy') && !order.includes('store'));
  assert.equal(records.lock, null);
});

test('the same commit with drifted services is deployed again, and redeploy deploys without asking', async (t) => {
  const drifted = await deploy(t, { sourceSha: SHA, live: [serviceOf('api', NEW_API), serviceOf('db', DB)] });
  const result = await drifted.run();
  assert.equal(result.ok, true);
  assert.match(result.lines.join('\n'), /runs this commit, but api \(updated outside a release\) differ: deploying again/u);
  assert.ok(drifted.order.includes('stack-deploy'));
  const forced = await deploy(t, { sourceSha: SHA, live: [serviceOf('api', OLD_API), serviceOf('db', DB)] }, { redeploy: true });
  await forced.run();
  assert.ok(forced.order.includes('stack-deploy'));
  assert.equal(phasesOf(forced.records).phases.some((p) => p.phase === 'idempotence'), false);
});

test('preflight pulls the images of the rollback target that the new release does not name, and refuses before the deploy when one no longer pulls', async (t) => {
  const ok = await deploy(t);
  await ok.run();
  assert.deepEqual(ok.pulls, [NEW_API, DB, OLD_API], 'the new images first, then only the target image the new release lacks');
  const gone = await deploy(t, { pullFails: [OLD_API] });
  const result = await gone.run().catch((error: unknown) => error as { code?: string; message: string });
  assert.equal((result as { code?: string }).code, 'STACK_DEPLOY_ROLLBACK_PULL');
  assert.match((result as { message: string }).message, /nothing was changed/u);
  assert.ok(!gone.order.includes('stack-deploy'));
  const doc = phasesOf(gone.records);
  assert.deepEqual(doc.phases.at(-1), { ...doc.phases.at(-1), phase: 'pre-pull', verdict: 'failed' });
  assert.equal(doc.outcome, 'refused');
});

test('a journal that fails after its first writes is a line of the result, never a failed deploy', async (t) => {
  const { run } = await deploy(t, { records: { failJournalAfter: 3 } });
  const result = await run();
  assert.equal(result.ok, true, result.lines.join(String.fromCharCode(10)));
  assert.match(result.lines.join(String.fromCharCode(10)), /journal: could not write [0-9T]+Z-[0-9a-f]{8}: the manager is read-only/u);
});

test('a rollback is one recorded attempt under the lock', async (t) => {
  const out = fs.mkdtempSync(path.join(tempRoot(), 'hfs-records-rollback-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const records = recordsDouble();
  const order: string[] = [];
  const store = {
    current: async () => 'b'.repeat(16), previous: async () => OLD_RELEASE, accept: async () => { order.push('accept'); }, store: async () => {},
    fetch: async (_id: string, dir: string) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'stack.yaml'), OLD_STACK); fs.writeFileSync(path.join(dir, 'release.json'), '{}'); return dir; },
    ...records,
  };
  const step = (name: string) => async () => { order.push(name); return { ok: true, lines: [] }; };
  const deps = { releaseStore: () => store, ssh: async () => ({ cleanup() {} }), reconcileEdge: step('edge'), convergeStack: step('converge'), verifyStack: step('verify') } as unknown as Partial<DeployDeps>;
  const ctx = contextOf({ spawn: () => ({ status: 0, stdout: '', stderr: '' }), env: {}, now: () => 1000, sleep: async () => {} });
  const dry = await rollbackRelease(ctx, configOf({ stack: 'shop', env: 'production' }), { execute: false }, deps);
  assert.equal(dry.ok, true);
  assert.equal(records.documents.size, 0, 'a dry run journals nothing and takes no lock');
  const result = await rollbackRelease(ctx, configOf({ stack: 'shop', env: 'production' }), { execute: true }, deps);
  assert.equal(result.ok, true);
  const doc = phasesOf(records);
  assert.deepEqual(doc.phases.map((p) => p.phase), ['lock', 'fetch', 'deploy', 'edge', 'converge', 'verify', 'accept']);
  assert.equal(doc.outcome, 'accepted');
  assert.equal(doc.releaseId, OLD_RELEASE);
  assert.equal(records.lock, null);
});

// ---- urgent --------------------------------------------------------------------------------------------------------------------------------

test('an urgent deploy is an attempt of its own trigger, journals its floor refusal and keeps the owner\'s record', async (t) => {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-records-urgent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const dir = path.join(root, '.git', 'starci-release');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sha}.urgent.json`), JSON.stringify({ schema: 'starci-app-urgent-record/1', head: sha, tag: 'v1.0.0', role: 'owner', reason: 'tonight', pushed: true }));
  fs.mkdirSync(path.join(root, '.starcistacks'));
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), 'database:\n  projectRef: abcdefghijklmnopqrst\n');
  const identity = path.join(root, 'identity.txt');
  fs.writeFileSync(identity, 'stand-in identity\n');
  const records = recordsDouble();
  const store = { current: async () => OLD_RELEASE, ...records };
  const deps = {
    releaseStore: () => store, ssh: async () => ({ cleanup() {} }),
    floor: { backup: async () => { throw new Error('supabase is not reachable'); } },
  } as unknown as Partial<DeployDeps>;
  const spawn = (command: string, args: string[]) => (command === 'git' ? { status: 0, stdout: path.join(root, '.git'), stderr: '' } : { status: 0, stdout: args.join(' '), stderr: '' });
  const ctx = contextOf({ cwd: root, env: { SOPS_AGE_KEY_FILE: identity, STARCI_ROLE: 'owner' }, now: Date.now, sleep: async () => {}, spawn });
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  const config = configOf({ repoRoot: root, project: 'shop', stack: 'shop', env: 'production', ingress: null, tasks: {}, postDeploy: [] });
  const rendered = { renderRelease: async (_c: unknown, _k: unknown, o: { out: string }) => { fs.writeFileSync(path.join(o.out, 'stack.yaml'), NEW_STACK); return { ok: true, lines: [] }; } };
  const result = await deployRelease(ctx, config, { sourceSha: sha, execute: true, urgent: true, out, reason: 'tonight' }, { ...deps, ...rendered } as Partial<DeployDeps>);
  assert.equal(result.ok, false);
  assert.equal(result.refused?.code, 'STACK_DEPLOY_BACKUP_FAILED');
  const doc = phasesOf(records) as unknown as { trigger: string; urgent: { role: string; reason: string; tag: string }; outcome: string; error: { code: string } };
  assert.equal(doc.trigger, 'urgent');
  assert.deepEqual(doc.urgent, { role: 'owner', reason: 'tonight', tag: 'v1.0.0' });
  assert.equal(doc.outcome, 'refused');
  assert.equal(doc.error.code, 'STACK_DEPLOY_BACKUP_FAILED');
  assert.equal(records.calls[0], 'try:urgent');
  assert.equal(records.lock, null);
});

// ---- status and drift ---------------------------------------------------------------------------------------------------------------------

const RELEASE_JSON = (accept: ObservedService[]) => ({ sourceSha: SHA, observed: { at: '2026-10-31T10:00:00.000Z', accept } });

test('the live services read as names, digests, update states and a task template hash, and nothing else', () => {
  const live = [serviceOf('db', DB, null), serviceOf('api', NEW_API, 'rollback_completed')];
  const spawn = (_command: string, args: readonly string[]) => {
    if (args[1] === 'ls') return { status: 0, stdout: 'shop_db\nshop_api\n', stderr: '' };
    const entry = live.find((one) => `shop_${one.service}` === args[2]) as ObservedService;
    return { status: 0, stdout: JSON.stringify({ ...inspectOf(entry), Spec: { ...inspectOf(entry).Spec, TaskTemplate: { ContainerSpec: { Image: entry.image, Env: ['TOKEN=hunter2'] } } } }), stderr: '' };
  };
  const seen = observedServices(contextOf({ spawn }), configOf({ stack: 'shop' }));
  assert.deepEqual(seen.map((s) => [s.service, s.digest, s.updateState]), [['api', digest('e'), 'rollback_completed'], ['db', digest('c'), null]]);
  assert.match(seen[0]?.taskTemplateHash ?? '', /^[0-9a-f]{16}$/u);
  assert.doesNotMatch(JSON.stringify(seen), /hunter2|TOKEN/u, 'the environment of a service never leaves the inspect');
});

test('drift: a service Swarm rolled back, a service updated by hand, a changed spec, a missing and an unknown service', () => {
  const stored = { stackYaml: NEW_STACK, release: RELEASE_JSON([serviceOf('api', NEW_API), serviceOf('db', DB)]) };
  assert.deepEqual(compareWithRelease(stored, [serviceOf('api', NEW_API), serviceOf('db', DB)]), []);
  const kinds = (live: ObservedService[]) => compareWithRelease(stored, live).map((entry) => `${entry.service}:${entry.kind}`);
  assert.deepEqual(kinds([serviceOf('api', OLD_API, 'rollback_completed'), serviceOf('db', DB)]), ['api:rolled back by swarm']);
  assert.deepEqual(kinds([serviceOf('api', OLD_API), serviceOf('db', DB)]), ['api:updated outside a release']);
  assert.deepEqual(kinds([serviceOf('api', NEW_API, 'completed', 'z'.repeat(16)), serviceOf('db', DB)]), ['api:updated outside a release']);
  assert.deepEqual(kinds([serviceOf('api', NEW_API)]), ['db:missing']);
  assert.deepEqual(kinds([serviceOf('api', NEW_API), serviceOf('db', DB), serviceOf('cache', DB)]), ['cache:not in the release']);
  const older = { stackYaml: NEW_STACK, release: { sourceSha: SHA } };
  assert.deepEqual(compareWithRelease(older, [serviceOf('api', NEW_API, 'completed', 'z'.repeat(16)), serviceOf('db', DB)]), [], 'a release accepted before the snapshots has only its digests to compare');
});

function statusWorld(live: ObservedService[], current = OLD_RELEASE) {
  const store = { current: async () => current, ...recordsDouble({ read: () => ({ stackYaml: NEW_STACK, release: RELEASE_JSON([serviceOf('api', NEW_API), serviceOf('db', DB)]) }) }) };
  return { deps: { ssh: async () => ({ cleanup() {} }), releaseStore: () => store, observedServices: () => live } as unknown as Parameters<typeof statusStack>[3] };
}

test('stack status prints PASS per service and is green when the live services run the accepted release', async () => {
  const { deps } = statusWorld([serviceOf('api', NEW_API), serviceOf('db', DB)]);
  const result = await statusStack(contextOf({}), configOf({ stack: 'shop' }), {}, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, [`status: accepted release ${OLD_RELEASE} (commit ${SHA.slice(0, 10)})`, `PASS  api  ${NEW_API.slice(NEW_API.indexOf('@') + 1, NEW_API.indexOf('@') + 20)}`, `PASS  db  ${DB.slice(DB.indexOf('@') + 1, DB.indexOf('@') + 20)}`, 'status: every service runs the accepted release']);
});

test('stack status reports a service Swarm rolled back by itself and fails', async () => {
  const { deps } = statusWorld([serviceOf('api', OLD_API, 'rollback_completed'), serviceOf('db', DB)]);
  const result = await statusStack(contextOf({}), configOf({ stack: 'shop' }), {}, deps);
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /DRIFT  api  rolled back by swarm: update state rollback_completed/u);
  assert.match(result.lines.at(-1) ?? '', /1 service\(s\) differ/u);
  assert.equal((result.data as { drift: unknown[] }).drift.length, 1);
});

test('stack status of an environment with no accepted release says so and is not a drift', async () => {
  const { deps } = statusWorld([], '');
  const result = await statusStack(contextOf({}), configOf({ stack: 'shop' }), {}, deps);
  assert.equal(result.ok, true);
  assert.match(result.lines[0] ?? '', /no accepted release/u);
});

test('stack verify fails a service that runs another digest than the pinned stack file, or that Swarm rolled back', async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(tempRoot(), 'hfs-records-verify-')), 'stack.yaml');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  fs.writeFileSync(file, NEW_STACK);
  const run = (live: ObservedService[]) => verifyStack(contextOf({
    now: () => 0, sleep: async () => {},
    spawn: (_command: string, args: readonly string[]) => (args[1] === 'ls'
      ? { status: 0, stdout: live.map((entry) => `shop_${entry.service}`).join('\n'), stderr: '' }
      : { status: 0, stdout: JSON.stringify(inspectOf(live.find((entry) => `shop_${entry.service}` === args[2]) as ObservedService)), stderr: '' }),
  }), configOf({ stack: 'shop', verify: { http: [], exec: [] }, stackFile: file }), { stackFile: file, skipPublic: true });
  assert.equal((await run([serviceOf('api', NEW_API), serviceOf('db', DB)])).ok, true);
  const swapped = await run([serviceOf('api', OLD_API), serviceOf('db', DB)]);
  assert.equal(swapped.ok, false);
  assert.match(swapped.lines.join('\n'), /FAIL  drift: the services run the digests of the stack file  api: updated outside a release/u);
  assert.equal((await run([serviceOf('api', OLD_API, 'rollback_completed'), serviceOf('db', DB)])).lines.join('\n').includes('api: rolled back by swarm'), true);
});

// ---- the command line ---------------------------------------------------------------------------------------------------------------------

test('--ci-run takes a numeric run id, never beside --urgent, and status is read-only and takes only --ssh-cmd', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-records-cli-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const stack = async (argv: string[]) => {
    let err = '';
    const code = await stackMain(argv, { cwd, env: {}, stdout: () => {}, stderr: (text) => { err += text; }, importer: async () => { throw new Error('no action module may load'); } });
    return { code, err };
  };
  assert.match((await stack(['deploy', '--env', 'production', '--ci-run', 'abc'])).err, /STACK_USAGE: --ci-run takes the numeric id of the CI run/u);
  assert.match((await stack(['deploy', '--env', 'production', '--urgent', '--ci-run', '12'])).err, /STACK_USAGE: --ci-run names the CI run that deploys; an urgent deploy runs no CI/u);
  assert.match((await stack(['status', '--env', 'production', '--execute'])).err, /STACK_USAGE: stack status takes no --execute: its flags are --env, --json, --ssh-cmd/u);
  assert.match((await stack(['verify', '--env', 'production', '--ci-run', '5'])).err, /STACK_USAGE: stack verify takes no --ci-run/u);
  assert.doesNotMatch((await stack(['status'])).err, /has an effect: name its environment/u, 'status defaults to production like the other read-only actions');
});

test('a journal document never carries the environment of the deploy', async (t) => {
  const { run, records } = await deploy(t, {}, {}, { env: { SOPS_AGE_KEY: 'AGE-SECRET-KEY-1ABC', GITHUB_TOKEN: 'ghs_secret' } });
  await run();
  assert.doesNotMatch(JSON.stringify([...records.documents.values(), ...records.index]), /AGE-SECRET|ghs_secret/u);
});
