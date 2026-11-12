// proves: HFS_PROJECT_CHECK_FAILED@lite
// proves: HFS_PROJECT_CHECK_FAILED@full
// R402 and PROJECT-LINT-3 (cache/project-checks.mts, scripts/lib/project-ext.mts, sync/harness-checks.mts): the project checks the project's
// ext/manifest.json `checks` declares run as the `checks` step of `starci app check`, green on exit 0 and HFS_PROJECT_CHECK_FAILED with the exit and
// the output otherwise; the declaration's shape; and `starci app sync` naming a loose check with the declaration to add, never moving it.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { declaredChecks, PROJECT_CHECK_FAILED, runProjectChecks } from '../cache/project-checks.mjs';
import type { ParityRun } from '../cache/parity-family.mjs';
import { CHECK_GRAPH } from '../cache/schedule.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import { PROJECT_EXT_INVALID, loadProjectExt } from '../runtime/scripts/lib/project-ext.mjs';
import { looseCheckNotices } from '../sync/harness-checks.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const DECLARATION = { hfs: 3, kind: 'app', project: 'demo', edition: 'lite', sides: { be: { apps: [{ name: 'api', kind: 'api' }] } } };

/** An app root holding `files` (app-relative path -> text). */
function appWith(t: TestContext, files: Record<string, string>): string {
  const root = mkdtemp(t, 'starci-project-checks-');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

/** The parity port as a plain child: what the governed one runs, and every argv it was asked for. */
function recordingRun(): { run: ParityRun; asked: { label: string; argv: readonly string[]; cwd: string; kind: string }[] } {
  const asked: { label: string; argv: readonly string[]; cwd: string; kind: string }[] = [];
  const run: ParityRun = async ({ kind, label, cwd, argv, env }) => {
    asked.push({ kind, label, cwd, argv });
    const [command = '', ...args] = argv;
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { run, asked };
}

/** The extension manifest that declares `checks`. */
const manifestOf = (checks: unknown): string => JSON.stringify({ schema: 'starci/project-ext@1', api: 1, checks });
/** The problems of an extension that declares `checks`, in an app holding the file ext/checks/x.mjs. */
const checksOf = (t: TestContext, checks: unknown): string[] => {
  const root = appWith(t, { 'hfs.json': JSON.stringify(DECLARATION), 'ext/manifest.json': manifestOf(checks), 'ext/checks/x.mjs': 'export {};\n', 'ext/checks/y.mjs': 'export {};\n' });
  const ext = loadProjectExt(root);
  assert.ok(ext.problems.every((problem) => problem.code === PROJECT_EXT_INVALID));
  return ext.problems.map((problem) => problem.message);
};

test('the checks step runs every declared check from the app root: exit 0 is one green line, any other exit is HFS_PROJECT_CHECK_FAILED with its exit, its why and its last lines', async (t) => {
  const root = appWith(t, {
    'hfs.json': JSON.stringify(DECLARATION),
    'ext/manifest.json': manifestOf([
      { id: 'tool-names', run: 'ext/checks/tool-names.mjs', why: 'no retired tool id is written anywhere' },
      { id: 'seed-ids', run: 'ext/checks/seed-ids.mjs', why: 'every seed id is unique' },
      { id: 'gone', run: 'ext/checks/gone.mjs', why: 'a file that was deleted' },
    ]),
    'ext/checks/tool-names.mjs': "import fs from 'node:fs';\nprocess.stdout.write(fs.existsSync('hfs.json') ? 'tool-names: clean\\n' : 'not at the app root\\n');\nprocess.exit(fs.existsSync('hfs.json') ? 0 : 1);\n",
    'ext/checks/seed-ids.mjs': "for (let i = 0; i < 30; i += 1) console.log(`line ${i}`);\nconsole.error('seeds/a.yaml:3 duplicate id lead-1');\nprocess.exit(3);\n",
  });
  const { run, asked } = recordingRun();
  const result = await runProjectChecks({ repoRoot: root, run, env: process.env });
  assert.deepEqual(asked.map((call) => [call.kind, call.label, call.argv.slice(1), path.resolve(call.cwd)]), [
    ['build', 'app check project check tool-names', ['ext/checks/tool-names.mjs'], path.resolve(root)],
    ['build', 'app check project check seed-ids', ['ext/checks/seed-ids.mjs'], path.resolve(root)],
  ], 'each declared file through the governed port, with this Node, from the app root; a missing file is never run');
  assert.equal(asked[0]?.argv[0], process.execPath);
  assert.deepEqual(result.lines, [
    '  project check tool-names (ext/checks/tool-names.mjs): green (exit 0): tool-names: clean',
    '  project check seed-ids (ext/checks/seed-ids.mjs): red (exit 3)',
    '  project check gone (ext/checks/gone.mjs): red, the file is missing',
  ]);
  assert.deepEqual(result.findings.map((finding) => [finding.code, finding.level, finding.path]), [
    [PROJECT_CHECK_FAILED, 'error', 'ext/checks/seed-ids.mjs'],
    [PROJECT_CHECK_FAILED, 'error', 'ext/checks/gone.mjs'],
  ]);
  const red = String(result.findings[0]?.message);
  assert.match(red, /^project check seed-ids \(ext\/checks\/seed-ids\.mjs\) failed \(exit 3\); it guards: every seed id is unique\n/u);
  assert.match(red, /seeds\/a\.yaml:3 duplicate id lead-1$/u, 'the last line it printed');
  assert.equal(red.split('\n').length, 1 + 20, 'the last 20 lines, no more');
  assert.match(String(result.findings[1]?.message), /runs ext\/checks\/gone\.mjs, which the app does not hold: restore the file or remove the check from ext\/manifest\.json checks/u);
});

test('an app that declares no check runs none and says so in one line; the checks step is never cached', async (t) => {
  const root = appWith(t, { 'hfs.json': JSON.stringify(DECLARATION) });
  const { run, asked } = recordingRun();
  assert.deepEqual(await runProjectChecks({ repoRoot: root, run, env: process.env }), { findings: [], lines: ['  project checks: none declared (ext/manifest.json checks)'] });
  assert.deepEqual(asked, []);
  assert.deepEqual(declaredChecks(appWith(t, { 'hfs.json': JSON.stringify(DECLARATION), 'ext/manifest.json': '{' })), [], 'an unreadable manifest is the extension check\'s (R381), not this step\'s');
  const step = CHECK_GRAPH.find((spec) => spec.id === 'checks');
  assert.deepEqual(step?.after, []);
  assert.match(step?.cache ?? '', /^none \(never cached/u);
  assert.ok(CHECK_GRAPH.find((spec) => spec.id === 'sonar-scan')?.after.includes('checks'), 'the Sonar scan waits for the project checks like every other finding');
});

test('the manifest checks is a non-empty list of {id, run, why}: a unique kebab-case id, a unique ext/checks/*.mjs file that is there, a reason; anything else is HFS_EXT_INVALID, and hfs.json holds no checks', (t) => {
  assert.deepEqual(checksOf(t, [{ id: 'tool-names', run: 'ext/checks/x.mjs', why: 'no retired tool id is written' }]), []);
  for (const bad of [
    [], 'ext/checks/x.mjs', [{ id: 'x', run: 'scripts/x-check.mjs', why: 'w' }], [{ id: 'x', run: 'scripts/checks/x.mjs', why: 'w' }], [{ id: 'x', run: 'ext/checks/x.js', why: 'w' }],
    [{ id: 'x', run: 'ext/checks/sub/x.mjs', why: 'w' }], [{ id: 'X_y', run: 'ext/checks/x.mjs', why: 'w' }], [{ id: 'x', run: 'ext/checks/x.mjs', why: ' ' }],
    [{ id: 'x', run: 'ext/checks/x.mjs' }], [{ id: 'x', run: 'ext/checks/x.mjs', why: 'w', args: ['--self-test'] }],
  ]) assert.match(checksOf(t, bad).join('|'), /checks is a list of \{ id, run, why \}/u, JSON.stringify(bad));
  assert.match(checksOf(t, [{ id: 'x', run: 'ext/checks/x.mjs', why: 'w' }, { id: 'x', run: 'ext/checks/y.mjs', why: 'w' }]).join('|'), /check x: the id is declared twice/u);
  assert.match(checksOf(t, [{ id: 'x', run: 'ext/checks/x.mjs', why: 'w' }, { id: 'y', run: 'ext/checks/x.mjs', why: 'w' }]).join('|'), /check y: ext\/checks\/x\.mjs is the file of another check too/u);
  assert.match(checksOf(t, [{ id: 'gone', run: 'ext/checks/gone.mjs', why: 'w' }]).join('|'), /check gone: ext\/checks\/gone\.mjs is declared and is not there/u, 'a declared check that cannot be found is red');
  const inDeclaration = declarationShapeProblems({ ...DECLARATION, checks: [{ id: 'x', run: 'ext/checks/x.mjs', why: 'w' }] }, ['be', 'fe']);
  assert.ok(inDeclaration.some((problem) => /unknown key checks: a project adds its own laws and checks in its ext\/ folder/u.test(problem)), JSON.stringify(inDeclaration));
});

test('sync names a check kept outside ext/checks with the declaration to add and the scripts to repoint, and moves nothing', (t) => {
  const root = appWith(t, {
    'hfs.json': JSON.stringify(DECLARATION),
    'package.json': JSON.stringify({ scripts: { 'tool-names:check': 'node scripts/tool-names-check.mjs', build: 'tsc' } }),
    'scripts/tool-names-check.mjs': 'export {};\n',
    'scripts/rotate-logs.mjs': 'export {};\n',
    'scripts/checkout.mjs': 'export {};\n',
    'tools/flow_check.cjs': 'module.exports = {};\n',
    'scripts/di-ring-check.mjs': 'export {};\n',
  });
  const notices = looseCheckNotices(root);
  assert.equal(notices.length, 2, notices.join('\n'));
  assert.equal(notices[0], 'notice: scripts/tool-names-check.mjs is a project check outside its home (R103, PROJECT-LINT-3); sync does not move it, since a check may resolve paths from its own folder and its why is the project\'s: move it to ext/checks/tool-names.mjs (an .mjs file), fix the paths it resolves from its folder, add {"id": "tool-names", "run": "ext/checks/tool-names.mjs", "why": "<what it guards>"} to ext/manifest.json checks, and point the package.json script(s) tool-names:check at ext/checks/tool-names.mjs; starci app check then runs it as its own checks step (R402)');
  assert.match(notices[1] ?? '', /^notice: tools\/flow_check\.cjs is a project check outside its home .* add \{"id": "flow", "run": "ext\/checks\/flow\.mjs"/u);
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'tool-names-check.mjs')), 'nothing moved');
  const declared = appWith(t, {
    'hfs.json': JSON.stringify(DECLARATION),
    'ext/manifest.json': manifestOf([{ id: 'tool-names', run: 'ext/checks/tool-names.mjs', why: 'no retired tool id' }]),
    'ext/checks/tool-names.mjs': 'export {};\n',
  });
  assert.deepEqual(looseCheckNotices(declared), [], 'a declared check in its folder is at home');
});
