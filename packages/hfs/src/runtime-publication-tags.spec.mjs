// The native runtime publisher's registry tag plan and reconciliation, without publication or network effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeTagPlan, reconcileRuntimeTags } from '../runtime/scripts/lib/runtime-publication-tags.mjs';
import { view } from '../runtime/scripts/api/npm/view.mjs';
import { distTag } from '../runtime/scripts/api/npm/dist-tag.mjs';
import { whoami } from '../runtime/scripts/api/npm/whoami.mjs';

const VERSION = '1.0.0-alpha.29';
const INTEGRITY = 'sha512-fixture';
const TAGS = ['alpha', 'latest'];
const stateOf = (distTags = { alpha: VERSION, latest: '1.0.0-alpha.26' }, versions = [VERSION]) => ({ state: 'present', integrity: INTEGRITY, versions, distTags });
const rowOf = (state) => ({ name: 'starci', version: VERSION, registry: state });

/** An npm registry whose tag writes affect subsequent reads, so retries and failed read-back are observable. */
function registryFixture({ state = stateOf(), write = true, result = { ok: true } } = {}) {
  const calls = [];
  const registry = {
    state: (...args) => { calls.push(['read', ...args]); return structuredClone(state); },
    tag: (name, version, tag) => {
      calls.push(['tag', name, version, tag]);
      if (write && result.ok) state.distTags[tag] = version;
      return result;
    },
  };
  return { calls, registry, state };
}

test('the dry-run tag plan names stale latest and the confirmed upload channel without registry writes', () => {
  const state = stateOf(), before = structuredClone(state);
  assert.deepEqual(runtimeTagPlan({ version: VERSION, tags: TAGS, state }), [
    { tag: 'alpha', version: VERSION, current: VERSION, action: 'confirmed' },
    { tag: 'latest', version: VERSION, current: '1.0.0-alpha.26', action: 'set' },
  ]);
  assert.deepEqual(state, before);
  const absent = { state: 'absent', versions: [], distTags: {} };
  assert.deepEqual(runtimeTagPlan({ version: VERSION, tags: TAGS, state: absent }).map(({ tag, action }) => [tag, action]), [['alpha', 'set'], ['latest', 'set']]);
});

test('an already published release repairs latest, reads it back and reruns without any write or upload', () => {
  const fixture = registryFixture(), lines = [];
  const run = () => reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: fixture.registry, out: (line) => lines.push(line) });
  run();
  assert.equal(fixture.state.distTags.latest, VERSION);
  assert.deepEqual(fixture.calls, [['read', 'starci', VERSION], ['tag', 'starci', VERSION, 'latest'], ['read', 'starci', VERSION]]);
  fixture.calls.length = 0;
  run();
  assert.deepEqual(fixture.calls, [['read', 'starci', VERSION], ['read', 'starci', VERSION]]);
  assert.equal(lines.length, 4);
});

test('first publication reconciles all release-declared tags and keeps unrelated tags intact', () => {
  const fixture = registryFixture({ state: stateOf({ beta: '1.0.0-beta.1' }) });
  reconcileRuntimeTags({ row: rowOf(stateOf()), tags: [...TAGS, 'reviewed', 'latest'], registry: fixture.registry, out: () => {} });
  assert.deepEqual(fixture.calls.filter(([kind]) => kind === 'tag').map((call) => call.at(-1)), ['alpha', 'latest', 'reviewed']);
  assert.deepEqual(fixture.state.distTags, { beta: '1.0.0-beta.1', alpha: VERSION, latest: VERSION, reviewed: VERSION });
});

test('retry resumes after one tag write succeeded and the next tag write failed', () => {
  const fixture = registryFixture({ state: stateOf({}) });
  const original = fixture.registry.tag;
  fixture.registry.tag = (name, version, tag) => tag === 'latest' ? { ok: false, status: 1 } : original(name, version, tag);
  assert.throws(() => reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: fixture.registry, out: () => {} }), /latest failed/);
  assert.deepEqual(fixture.state.distTags, { alpha: VERSION });
  fixture.registry.tag = original;
  fixture.calls.length = 0;
  reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: fixture.registry, out: () => {} });
  assert.deepEqual(fixture.calls.filter(([kind]) => kind === 'tag'), [['tag', 'starci', VERSION, 'latest']]);
});

test('a tag failure, stale read-back or changed immutable integrity is red and retry can repair partial effects', () => {
  for (const options of [{ result: { ok: false, status: 1 } }, { write: false }]) {
    const fixture = registryFixture(options);
    assert.throws(() => reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: fixture.registry, out: () => {} }), /failed|read-back/);
  }
  const fixture = registryFixture({ state: { ...stateOf(), integrity: 'changed' } });
  assert.throws(() => reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: fixture.registry, out: () => {} }), /integrity changed/);
  assert.equal(fixture.calls.some(([kind]) => kind === 'tag'), false);
  const partial = registryFixture({ state: stateOf({ alpha: VERSION }) });
  reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: partial.registry, out: () => {} });
  assert.equal(partial.state.distTags.latest, VERSION);
});

test('a newer release on the line blocks historical publication, including numeric prerelease precedence', () => {
  for (const newer of ['1.0.0-alpha.30', '1.0.0-alpha.100']) {
    const state = stateOf({}, [VERSION, newer]);
    assert.throws(() => runtimeTagPlan({ version: VERSION, tags: TAGS, state }), /behind .*release line/);
  }
  const state = stateOf({ latest: '1.0.0-alpha.9' }, [VERSION, '1.0.0-alpha.9']);
  assert.equal(runtimeTagPlan({ version: VERSION, tags: TAGS, state })[1].action, 'set');
  assert.throws(() => runtimeTagPlan({ version: '1.0.9', tags: ['latest'], state: { state: 'absent', versions: ['1.0.10'], distTags: {} } }), /behind/);
});

test('a wave release moves latest forward on the one alpha line and never behind a later wave or line', () => {
  const wave = '1.0.0-alpha.31.1';
  const after31 = { state: 'absent', versions: ['1.0.0-alpha.31'], distTags: { alpha: '1.0.0-alpha.31', latest: '1.0.0-alpha.31' } };
  assert.deepEqual(runtimeTagPlan({ version: wave, tags: TAGS, state: after31, uploadTag: 'alpha' }).map(({ tag, version, action }) => [tag, version, action]),
    [['alpha', wave, 'set'], ['latest', wave, 'set']]);
  const afterWave = { state: 'absent', versions: ['1.0.0-alpha.31', wave], distTags: { alpha: wave, latest: wave } };
  assert.deepEqual(runtimeTagPlan({ version: '1.0.0-alpha.31.2', tags: TAGS, state: afterWave }).map(({ action }) => action), ['set', 'set']);
  assert.deepEqual(runtimeTagPlan({ version: '1.0.0-alpha.32', tags: TAGS, state: afterWave }).map(({ action }) => action), ['set', 'set']);
  for (const newer of ['1.0.0-alpha.31.2', '1.0.0-alpha.32', '1.0.0-alpha.31-fix.2'])
    assert.throws(() => runtimeTagPlan({ version: wave, tags: TAGS, state: { ...afterWave, versions: [...afterWave.versions, newer] } }), /behind .*release line/);
  const legacyLatest = { state: 'absent', versions: ['1.0.0-alpha.31-fix.1'], distTags: { latest: '1.0.0-alpha.31-fix.1' } };
  assert.equal(runtimeTagPlan({ version: '1.0.0-alpha.31.2', tags: ['latest'], state: legacyLatest })[0].action, 'set');
});

test('a newer tag on another line is preserved, including stable and nonnumeric prereleases', () => {
  for (const latest of ['1.0.0', '1.0.0-beta.1', '1.1.0-alpha.1', '2.0.0']) {
    const state = stateOf({ alpha: VERSION, latest }, [VERSION, latest]);
    const plan = runtimeTagPlan({ version: VERSION, tags: TAGS, state });
    assert.deepEqual(plan[1], { tag: 'latest', version: latest, current: latest, action: 'preserve' });
  }
  const state = stateOf({ latest: '1.0.0-alpha' }, [VERSION]);
  assert.equal(runtimeTagPlan({ version: VERSION, tags: TAGS, state })[1].action, 'set');
});

test('uploading a new version refuses when npm publish would overwrite a preserved upload channel', () => {
  const state = { state: 'absent', versions: ['2.0.0-alpha.1'], distTags: { alpha: '2.0.0-alpha.1', latest: '2.0.0-alpha.1' } };
  assert.throws(() => runtimeTagPlan({ version: VERSION, tags: TAGS, state, uploadTag: 'alpha' }), /upload channel alpha/);
  assert.deepEqual(runtimeTagPlan({ version: VERSION, tags: TAGS, state }).map(({ action }) => action), ['preserve', 'preserve']);
});

test('unreadable registry inventories, malformed versions and missing tag declarations fail closed', () => {
  for (const state of [{ state: 'unreachable' }, { state: 'present', versions: [], distTags: {} }, { ...stateOf(), distTags: [] }, { ...stateOf(), distTags: { latest: false } }, stateOf({}, ['broken'])])
    assert.throws(() => runtimeTagPlan({ version: VERSION, tags: TAGS, state }));
  for (const tags of [null, [], ['1.2'], ['bad tag']]) assert.throws(() => runtimeTagPlan({ version: VERSION, tags, state: stateOf() }), /declared/);
  assert.throws(() => runtimeTagPlan({ version: '1.0.0-alpha.01', tags: TAGS, state: stateOf() }), /invalid/);
  const fixture = registryFixture({ state: { state: 'unreachable' } });
  assert.throws(() => reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: fixture.registry, out: () => {} }), /integrity/);
});

test('version parsing keeps SemVer identifier bounds and ignores build metadata for precedence', () => {
  for (const version of ['01.0.0', '1.0', '1.0.0-', '1.0.0-alpha..1', '1.0.0+', '1.0.0+one+two', '1.0.0+bad/value'])
    assert.throws(() => runtimeTagPlan({ version, tags: TAGS, state: stateOf() }), /unreadable/);
  const version = `${VERSION}+build.2`;
  const state = { state: 'absent', versions: [VERSION], distTags: { alpha: `${VERSION}+build.1` } };
  assert.equal(runtimeTagPlan({ version, tags: TAGS, state })[0].version, version);
});

test('the npm view edge reads all dist-tags and versions alongside exact-version integrity', () => {
  const calls = [];
  const state = view('starci', VERSION, { cwd: 'release-root', run: (args, options) => {
    assert.equal(options.cwd, 'release-root');
    calls.push(args);
    return { status: 0, stdout: JSON.stringify(calls.length === 1 ? { versions: [VERSION], 'dist-tags': { alpha: VERSION, latest: '1.0.0-alpha.26' } } : INTEGRITY) };
  } });
  assert.deepEqual(state, { ...stateOf(), latest: '1.0.0-alpha.26' });
  assert.deepEqual(calls, [['view', 'starci', 'versions', 'dist-tags', '--json'], ['view', `starci@${VERSION}`, 'dist.integrity', '--json']]);
  const missing = view('starci', VERSION, { run: () => ({ status: 1, stderr: 'E404 Not Found' }) });
  assert.deepEqual(missing, { state: 'absent', latest: '-', versions: [], distTags: {} });
});

test('npm reads never treat invalid JSON, incomplete metadata or interrupted processes as an absent release', () => {
  for (const result of [{ status: 0, stdout: 'invalid' }, { status: 0, stdout: '{}' }, { status: 0, stdout: '{"versions":["1.0.0"]}' },
    { status: 1, stderr: 'EAI_AGAIN' }, { status: 0, signal: 'SIGTERM', stderr: 'E404' }, { status: null }, { status: 0, error: new Error('interrupted') }])
    assert.equal(view('starci', VERSION, { run: () => result }).state, 'unreachable');
});

test('the npm dist-tag edge sets the explicit package/version/tag and retains process failures', () => {
  const calls = [];
  assert.deepEqual(distTag('starci', VERSION, 'latest', { cwd: 'release-root', run: (args, options) => { assert.equal(options.cwd, 'release-root'); calls.push(args); return { status: 0 }; } }), { ok: true, status: 0 });
  assert.deepEqual(calls, [['dist-tag', 'add', `starci@${VERSION}`, 'latest']]);
  for (const result of [{ status: 1 }, { status: null }, { status: 0, signal: 'SIGTERM' }, { status: 0, error: new Error('failed') }])
    assert.equal(distTag('starci', VERSION, 'latest', { run: () => result }).ok, false);
});

test('npm identity uses the selected release root and refuses interrupted reads', () => {
  const account = whoami({ cwd: 'release-root', run: (args, options) => {
    assert.deepEqual(args, ['whoami']);
    assert.equal(options.cwd, 'release-root');
    return { status: 0, stdout: 'fixture-owner\n' };
  } });
  assert.equal(account, 'fixture-owner');
  assert.equal(whoami({ run: () => ({ status: 0, signal: 'SIGTERM', stdout: 'fixture-owner' }) }), null);
});

test('a stale first read-back is polled until the registry confirms the tags, and a read-back that never confirms is red', () => {
  const fixture = registryFixture();
  const reads = fixture.registry.state;
  let stale = 1;
  fixture.registry.state = (...args) => { const seen = reads(...args); if (args.length && fixture.calls.filter(([kind]) => kind === 'tag').length && stale-- > 0) seen.distTags.latest = '1.0.0-alpha.26'; return seen; };
  const slept = [];
  reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: fixture.registry, out: () => {}, sleep: (ms) => slept.push(ms), waitMs: 60_000, stepMs: 7 });
  assert.deepEqual(slept, [7]);
  const never = registryFixture({ write: false });
  assert.throws(() => reconcileRuntimeTags({ row: rowOf(stateOf()), tags: TAGS, registry: never.registry, out: () => {}, sleep: () => {}, waitMs: 15, stepMs: 1 }), /read-back/);
});
