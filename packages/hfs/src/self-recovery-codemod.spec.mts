// `starci app codemod self-recovery` moves an app's jobs, queue and event-bus platform onto the self-recovering flows (BE-RESILIENCE-2) by a
// three-way comparison with the versioned template snapshot the package ships (templates/snapshots/<version>, decision
// versioned-template-snapshots): a file equal to the snapshot's rendering is rewritten, a current file is left, a hand-edited one is left for
// a person and then nothing is written; the templates added since are added, and a lite app gains the park migration once.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { migrateSelfRecovery, SELF_RECOVERY_SNAPSHOT, selfRecoveryMarkdown, selfRecoveryPlacements, withLegacyResumeForm } from '../codemod/self-recovery.mjs';

const TEMPLATES = path.join(import.meta.dirname, '..', 'templates');
const SNAPSHOT = path.join(TEMPLATES, 'snapshots', SELF_RECOVERY_SNAPSHOT);
const manifest = JSON.parse(fs.readFileSync(path.join(SNAPSHOT, 'manifest.json'), 'utf8')) as { version: string; templates: string[]; added: string[] };
const old = (template: string): string => fs.readFileSync(path.join(SNAPSHOT, template), 'utf8');
const now = (template: string): string => fs.readFileSync(path.join(TEMPLATES, template), 'utf8').replace(/\r\n/g, '\n');

/** A lite app with the jobs, queue and event-bus platform as the snapshot release rendered it. */
function liteApp(t: TestContext, extra: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-self-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files: Record<string, string> = { 'hfs.json': JSON.stringify({ hfs: 3, kind: 'app', project: 'demo', edition: 'lite' }), 'db/migrations/20261101000000_jobs.sql': 'select 1;\n', ...extra };
  for (const placement of selfRecoveryPlacements('lite')) {
    if (manifest.added.includes(placement.template)) continue;
    files[placement.app] ??= manifest.templates.includes(placement.template) ? old(placement.template) : now(placement.template);
  }
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

const read = (root: string, file: string): string => fs.readFileSync(path.join(root, file), 'utf8');

test('self-recovery is one of the codemods, and its snapshot holds every template it names', () => {
  assert.ok(CODEMODS.includes('self-recovery'));
  assert.equal(manifest.version, SELF_RECOVERY_SNAPSHOT);
  for (const template of manifest.templates) assert.ok(fs.existsSync(path.join(SNAPSHOT, template)), template);
  for (const template of manifest.added) assert.ok(fs.existsSync(path.join(TEMPLATES, template)) && !fs.existsSync(path.join(SNAPSHOT, template)), template);
  assert.ok(selfRecoveryPlacements('lite').some((placement) => placement.app === 'be/src/modules/platform/event-bus/event-consumer.service.ts'), 'the lite pgmq consumer is placed');
  assert.ok(selfRecoveryPlacements('full').some((placement) => placement.app.startsWith('be/src/modules/platform/event-bus/')), 'the full event runner is placed');
  assert.ok(selfRecoveryPlacements('full').every((placement) => !placement.app.includes('<')), 'no per-instance file');
});

test('a dry run rewrites every file of the snapshot to the current template, adds the new ones and the park migration, and writes nothing', async (t) => {
  const root = liteApp(t);
  const runner = 'be/src/modules/platform/event-bus/event-consumer.service.ts';
  const before = read(root, runner);
  const report = await migrateSelfRecovery({ root, prettier: null, now: () => Date.UTC(2026, 10, 4) });
  assert.deepEqual(report.findings, []);
  assert.ok(report.changes.some((change) => change.file === runner && change.action === 'rewrite'));
  assert.ok(report.changes.some((change) => change.file === 'be/src/modules/platform/jobs/parked-job-resumer.service.ts' && change.action === 'add'));
  assert.ok(report.changes.some((change) => /^db\/migrations\/\d{14}_jobs-failed-awaiting-fix\.sql$/u.test(change.file) && change.action === 'add'));
  assert.equal(read(root, runner), before, 'a dry run writes nothing');
  assert.match(selfRecoveryMarkdown(report), /would change, 0 left for a person/u);
});

test('--execute writes the current templates, and a second run finds nothing to do', async (t) => {
  const root = liteApp(t);
  const first = await migrateSelfRecovery({ root, write: true, prettier: null, now: () => Date.UTC(2026, 10, 4) });
  assert.ok(first.changes.length > 0);
  assert.equal(read(root, 'be/src/modules/platform/event-bus/event-consumer.service.ts'), now('be/inbox/platform/event-bus/event-consumer.service.ts.tpl'));
  assert.equal(read(root, 'be/src/modules/platform/jobs/parked-job-resumer.service.ts'), now('be/patterns/jobs/platform/parked-job-resumer.service.ts.tpl'));
  const migration = fs.readdirSync(path.join(root, 'db', 'migrations')).filter((name) => name.endsWith('_jobs-failed-awaiting-fix.sql'));
  assert.equal(migration.length, 1);
  assert.ok((migration[0] ?? '') > '20261101000000', 'the stamp follows the latest migration');
  const second = await migrateSelfRecovery({ root, write: true, prettier: null });
  assert.deepEqual([second.changes, second.findings], [[], []]);
});

test('a file the app edited by hand is left for a person and nothing is written; an app without the capability is untouched', async (t) => {
  const runner = 'be/src/modules/platform/event-bus/event-consumer.service.ts';
  const root = liteApp(t, { [runner]: `${old('be/inbox/platform/event-bus/event-consumer.service.ts.tpl')}// the app's own line\n` });
  const report = await migrateSelfRecovery({ root, write: true, prettier: null });
  assert.deepEqual(report.findings.map((finding) => [finding.file, finding.code]), [[runner, 'SELF_RECOVERY_FILE_BY_HAND']]);
  assert.ok(!fs.existsSync(path.join(root, 'be/src/modules/platform/jobs/parked-job-resumer.service.ts')), 'nothing is written while a person is needed');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-self-recovery-bare-'));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bare, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'demo' }));
  const empty = await migrateSelfRecovery({ root: bare, write: true, prettier: null });
  assert.deepEqual([empty.changes, empty.findings], [[], []]);
});

test('an app rendered by hfs 6.5.x with the old <jobKey>-r<n> form is rewritten to <jobKey>:r<n>; an edited one is left for a person', async (t) => {
  const contracts = 'be/src/modules/platform/jobs/jobs.contracts.ts';
  const template = 'be/patterns/jobs/platform/jobs.contracts.ts.tpl';
  const legacy = withLegacyResumeForm(now(template));
  assert.notEqual(legacy, now(template));
  assert.match(legacy, /-r\$\{String\(resumeCount\)\}/u);
  const root = liteApp(t, { [contracts]: legacy });
  const dry = await migrateSelfRecovery({ root, prettier: null, now: () => Date.UTC(2026, 10, 4) });
  assert.ok(dry.changes.some((change) => change.file === contracts && change.action === 'rewrite'));
  await migrateSelfRecovery({ root, write: true, prettier: null, now: () => Date.UTC(2026, 10, 4) });
  assert.equal(read(root, contracts), now(template));
  assert.match(read(root, contracts), /:r\$\{String\(resumeCount\)\}/u);
  const edited = liteApp(t, { [contracts]: `${legacy}// the app's own line\n` });
  const report = await migrateSelfRecovery({ root: edited, write: true, prettier: null });
  assert.deepEqual(report.findings.map((finding) => [finding.file, finding.code]), [[contracts, 'SELF_RECOVERY_FILE_BY_HAND']]);
});

test('the command runs dry by default, writes with --execute and exits 1 with the report when a person is needed', async (t) => {
  const root = liteApp(t);
  const out: string[] = [];
  const io = { cwd: root, stdout: (text: string) => { out.push(text); }, stderr: (text: string) => { out.push(text); } };
  assert.equal(await codemodMain(['self-recovery', '--format', 'json'], io), 0);
  assert.equal(JSON.parse(out.join('')).write, false);
  const handRoot = liteApp(t, { 'be/src/modules/platform/jobs/job-runner.service.ts': 'export {}\n' });
  assert.equal(await codemodMain(['self-recovery'], { ...io, cwd: handRoot }), 1);
});
