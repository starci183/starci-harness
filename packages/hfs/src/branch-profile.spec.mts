// proves: HFS_BRANCH_PROFILE_INVALID@lite
// proves: HFS_BRANCH_PROFILE_INVALID@full
// proves: LINT_RATCHET_RAISED@lite
// proves: LINT_RATCHET_RAISED@full
// Branch profiles (.starcistacks/application-stacks.yaml `branches`): a profile branch reports or turns off only the polish gates (lint, sonar, codecov), the
// default branch is never declared or lowered, the safety gates block everywhere, the profile is chosen from the branch the run judges (a pull request into
// main runs the full gate), and where lint reports the lint ratchet refuses a commit that adds lint findings to a file it touches.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from './main.mjs';
import { RATCHET_TEXTS_PER_CHILD, committedLintCounts, ratchetFindings, sessionLintCounts, type RecordedCounts } from '../lint/ratchet.mjs';
import { hashText } from '../cache/hash.mjs';
import { completedNode, incompleteReason } from '../runtime/scripts/api/node/run-node.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { activeProfile, familyModes, profileNotices } from '../runtime/scripts/hfs/branch-profile.mjs';
import { matchesBranch, profileFor, profilePolicy, readBranchProfiles } from '../runtime/scripts/lib/stack-declaration.mjs';
import { ciWorkflowCommands } from '../sync/ci-commands.mjs';
import { deployWorkflowFindings } from '../runtime/scripts/hfs/rules/deploy-workflow.mjs';
import { parseWorkflow } from '../runtime/scripts/hfs/runtime-rules/workflow-source.mjs';
import { renderTargets } from '../sync/index.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { runLinter, type LinterRunner } from '../lint/run.mjs';
import type { HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';

// reason: a rendered workflow and the JSON report are parsed data the cases read freely
type Doc = any;

const POLICY = profilePolicy({});
const DEV = 'branches:\n  dev:\n    gates:\n      lint: report\n      sonar: report\n';
const declaration = (branches: string): string => ['schema: starci/application-stacks@1', 'services:', '  sonar:', '    provider: sonarqube', '    mode: local', '    stack:', '      owner: host', '      root: .claude/ext/sonar', branches].join('\n');
const doc = (yaml: Record<string, unknown>): Record<string, unknown> => ({ schema: 'starci/application-stacks@1', ...yaml });

test('a dev profile lowers lint and sonar; the default branch and every safety gate are refused, and so is a branch or gate the policy does not allow', () => {
  const sound = readBranchProfiles(doc({ branches: { dev: { gates: { lint: 'report', sonar: 'report', codecov: 'off', hfs: 'blocking' } } } }), POLICY);
  assert.deepEqual(sound.problems, []);
  assert.deepEqual(sound.profiles, { dev: { lint: 'report', sonar: 'report', codecov: 'off', hfs: 'blocking' } });
  for (const branch of ['main', 'master']) {
    const lowered = readBranchProfiles(doc({ branches: { [branch]: { gates: { lint: 'report' } } } }), POLICY);
    assert.deepEqual(lowered.profiles, {}, `${branch} keeps the full gate`);
    assert.match(lowered.problems[0]?.message ?? '', /is the default branch: it always runs the full gate and is never declared or lowered/u);
  }
  const trunk = readBranchProfiles(doc({ ci: { github: { repository: 'o/r', defaultBranch: 'dev' } }, branches: { dev: { gates: { lint: 'report' } } } }), POLICY);
  assert.equal(trunk.defaultBranch, 'dev');
  assert.match(trunk.problems[0]?.message ?? '', /dev is the default branch/u, 'the declared default branch is never lowered either');
  for (const gate of ['hfs', 'types', 'wiring', 'db', 'secrets', 'format', 'test']) {
    for (const mode of ['report', 'off']) {
      const unsafe = readBranchProfiles(doc({ branches: { dev: { gates: { lint: 'report', [gate]: mode } } } }), POLICY);
      assert.deepEqual(unsafe.profiles, {}, `${gate}: ${mode} refuses the whole profile`);
      assert.match(unsafe.problems[0]?.message ?? '', new RegExp(`${gate} is a safety gate: it blocks on every branch and is never lowered`, 'u'));
    }
  }
  assert.match(readBranchProfiles(doc({ branches: { staging: { gates: { lint: 'report' } } } }), POLICY).problems[0]?.message ?? '', /staging may not carry a branch profile: policy\/loosening\.yaml branchProfiles allows dev/u);
  const narrow = readBranchProfiles(doc({ branches: { dev: { gates: { sonar: 'report' } } } }), profilePolicy({ STARCI_PROFILE_GATES: 'lint' }));
  assert.match(narrow.problems[0]?.message ?? '', /sonar may not be lowered: policy\/loosening\.yaml branchProfiles allows lint/u);
  assert.deepEqual(profilePolicy({ STARCI_PROFILE_GATES: 'lint,types' }).gates, new Set(['lint']), 'the policy never widens past the polish gates');
  const shapes = readBranchProfiles(doc({ branches: { dev: { gates: { lint: 'quiet', nope: 'report' } }, 'feat/**': { gates: {} } } }), POLICY).problems.map((problem) => problem.message);
  assert.ok(shapes.some((message) => /quiet is not a gate mode/u.test(message)));
  assert.ok(shapes.some((message) => /nope is not a gate/u.test(message)));
  assert.ok(shapes.some((message) => /feat\/\*\* is not a branch pattern/u.test(message)));
});

test('HFS_BRANCH_PROFILE_INVALID: the app check refuses a lowered main and a lowered safety gate, and accepts a dev profile', (t) => {
  for (const [branches, refused] of [[DEV, 0], ['branches:\n  main:\n    gates:\n      lint: report\n', 1], ['branches:\n  dev:\n    gates:\n      secrets: off\n', 1]] as const) {
    const root = mkdtemp(t, 'starci-branch-profile-');
    const files = { '.starcistacks/application-stacks.yaml': declaration(branches), '.starcistacks/dev/environment.json': '{}' };
    for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
    const report = checkRepo({ repoRoot: root, declaration: { hfs: 3, kind: 'app', project: 'fixture', edition: 'full', sides: { be: { apps: [{ name: 'core', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } }, files: Object.keys(files), tree: false });
    const found = report.findings.filter((finding) => finding.code === 'HFS_BRANCH_PROFILE_INVALID');
    assert.equal(found.length, refused, branches);
    for (const finding of found) assert.equal(finding.level, 'error');
  }
});

// ------------------------------------------------------------------------------------------------ a scratch app on a branch

interface App { root: string; git: (...args: string[]) => string }

/** A fake canon of `side` (its config selects src/**\/*.ts) and the side's eslint.config.mjs, the way check-eslint.spec builds them. */
function canon(root: string, side: string): void {
  const factory = side === 'be' ? 'starciBeConfig' : 'starciFeConfig';
  const directory = path.join(root, 'node_modules', '@starci', `eslint-canon-${side}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@starci/eslint-canon-${side}`, type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(path.join(directory, 'index.mjs'), [
    "import fs from 'node:fs';", "import path from 'node:path';", "import { fileURLToPath } from 'node:url';",
    `export const loadHfs = url => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(url)), '../hfs.json'), 'utf8')).sides.${side};`,
    `export const ${factory} = () => [{ files: ['src/**/*.ts'] }];`,
  ].join('\n'));
  fs.writeFileSync(path.join(root, side, 'eslint.config.mjs'), `import { loadHfs, ${factory} } from '@starci/eslint-canon-${side}';\nexport default ${factory}({ hfs: loadHfs(import.meta.url) });\n`);
}

/** A committed app on `branch` with a dev profile, `be/src/dirty.ts` carrying two lint findings (each `BAD` is one). */
function scratchApp(t: TestContext, branch: string, branches = DEV): App {
  const root = mkdtemp(t, 'starci-branch-app-');
  const write = (file: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('package.json', '{"private":true}');
  write('hfs.json', JSON.stringify({ hfs: 3, kind: 'app', project: 'fixture', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] } } }));
  write('.gitignore', 'node_modules/\n');
  write('.starcistacks/application-stacks.yaml', declaration(branches));
  write('be/src/dirty.ts', 'export const a = "BAD";\nexport const b = "BAD";\n');
  write('be/src/clean.ts', 'export const c = 1;\n');
  write('fe/src/view.ts', 'export const v = 1;\n');
  canon(root, 'be');
  canon(root, 'fe');
  const family = path.join(root, 'node_modules', '@starci', 'eslint-grammar-core');
  fs.mkdirSync(family, { recursive: true });
  fs.writeFileSync(path.join(family, 'package.json'), JSON.stringify({ name: '@starci/eslint-grammar-core', type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(path.join(family, 'index.mjs'), 'export const coreGrammarConfig = () => [];\n');
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=spec', '-c', 'user.email=spec@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', branch);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return { root, git };
}

/** One lint finding per `BAD` of the text: a file on disk for a whole-side run, the text itself for a ratchet run. */
const counting = (calls: { texts: number }[] = []): LinterRunner => async ({ cwd, pkg, args, list, texts }) => {
  if (pkg !== 'eslint') return { results: [] };
  const messages = (text: string) => [...text.matchAll(/BAD/gu)].map((_, index) => ({ ruleId: 'fixture/no-bad', severity: 2, message: `BAD ${String(index)}`, line: 1, column: 1 }));
  if (texts !== undefined) { calls.push({ texts: texts.length }); return { results: texts.map(({ file, text }) => ({ filePath: path.join(cwd, file), messages: messages(text) })) }; }
  const files = list ?? fs.readdirSync(path.join(cwd, 'src')).map((name) => `src/${name}`);
  void args;
  return { results: files.map((file) => ({ filePath: path.join(cwd, file), messages: messages(fs.readFileSync(path.join(cwd, file), 'utf8')) })) };
};

const cleanCheck = (root: string, findings: Record<string, unknown>[] = []) => ({ ok: findings.length === 0, repoRoot: root, profile: 'app', manifest: '3.4.0', tracked: 3,
  findings, counts: { error: findings.length, warning: 0, info: 0 }, machine: { status: 'ran', files: 3, kinds: ['backend'] } });

async function check(app: App, argv: string[], { env = {}, findings = [], run = counting() }: { env?: NodeJS.ProcessEnv; findings?: Record<string, unknown>[]; run?: LinterRunner } = {}) {
  let stdout = '';
  const exit = await main(['check', ...argv], { cwd: app.root, env: { PATH: process.env.PATH, ...env }, checkApp: ({ repoRoot }: { repoRoot: string }) => cleanCheck(repoRoot, findings), runLinter: run, stdout: (text: string) => { stdout += text; }, stderr: () => undefined });
  return { exit, stdout, report: argv.includes('--json') ? JSON.parse(stdout) as Doc : null };
}

test('a branch pattern covers the feature branches of dev; it never matches the default branch, never starts with release/, and needs the policy', () => {
  assert.deepEqual(POLICY.branches, ['dev', 'ui/*'], 'the runtime policy allows dev and its ui/* feature branches');
  for (const [pattern, branch, hit] of [['ui/*', 'ui/3', true], ['ui/*', 'ui/10', true], ['ui/*', 'ui', false], ['ui/*', 'ui/3/x', false], ['ui/*', 'xui/3', false], ['ui/*-x', 'ui/a-x', true], ['dev', 'dev', true], ['ui.v/*', 'uixv/1', false]] as const) {
    assert.equal(matchesBranch(pattern, branch), hit, `${pattern} ${branch}`);
  }
  const sound = readBranchProfiles(doc({ branches: { dev: { gates: { lint: 'report' } }, 'ui/*': { gates: { lint: 'report', sonar: 'report' } } } }), POLICY);
  assert.deepEqual(sound.problems, []);
  assert.deepEqual(profileFor(sound.profiles, 'ui/3'), { key: 'ui/*', gates: { lint: 'report', sonar: 'report' } });
  assert.deepEqual(profileFor(sound.profiles, 'dev'), { key: 'dev', gates: { lint: 'report' } }, "a branch's own entry wins");
  assert.equal(profileFor(sound.profiles, 'feature/3'), null);
  const message = (key: string, policy = POLICY, extra: Record<string, unknown> = {}): string => readBranchProfiles(doc({ ...extra, branches: { [key]: { gates: { lint: 'report' } } } }), policy).problems[0]?.message ?? '';
  // A pattern that could match the default branch is refused, whether the default is main, master or the declared one.
  assert.match(message('*'), /\* matches the default branch main, master: it always runs the full gate/u);
  assert.match(message('ma*'), /ma\* matches the default branch main/u);
  assert.match(message('tr*', POLICY, { ci: { github: { repository: 'o/r', defaultBranch: 'trunk' } } }), /tr\* matches the default branch trunk/u);
  assert.match(message('*/x', profilePolicy({ STARCI_PROFILE_BRANCHES: '*/x' })), /\*\/x is not a branch pattern: a literal first segment/u, 'a pattern starts with a literal segment');
  assert.match(message('release/*', profilePolicy({ STARCI_PROFILE_BRANCHES: 'release/*' })), /would cover the release candidates/u);
  assert.match(message('feature/*'), /feature\/\* may not carry a branch profile: policy\/loosening\.yaml branchProfiles allows dev, ui\/\*/u);
  assert.deepEqual(readBranchProfiles(doc({ branches: { 'ui/3': { gates: { lint: 'report' } } } }), POLICY).problems, [], 'a name a policy pattern covers may carry its own profile');
  // Two patterns that both match a branch lower a gate only as far as the stricter of them.
  const two = readBranchProfiles(doc({ branches: { 'ui/*': { gates: { lint: 'off', sonar: 'report' } }, 'ui/*-x': { gates: { lint: 'report' } } } }), profilePolicy({ STARCI_PROFILE_BRANCHES: 'ui/*,ui/*-x' }));
  assert.deepEqual(profileFor(two.profiles, 'ui/a-x'), { key: 'ui/* + ui/*-x', gates: { lint: 'report' } });
});

test('on a ui/* branch the pattern profile applies: lint and sonar report, the safety gates block, main and a pull request into main keep the full gate', (t) => {
  const app = scratchApp(t, 'ui/3', 'branches:\n  dev:\n    gates:\n      lint: report\n  "ui/*":\n    gates:\n      lint: report\n      sonar: report\n');
  const profile = activeProfile(app.root, {});
  assert.deepEqual([profile.branch, profile.profile], ['ui/3', 'ui/*']);
  assert.deepEqual({ lint: profile.modes.lint, sonar: profile.modes.sonar, codecov: profile.modes.codecov }, { lint: 'report', sonar: 'report', codecov: 'blocking' });
  for (const family of ['hfs', 'types', 'wiring', 'db', 'secrets', 'format', 'test']) assert.equal(familyModes(profile)[family], 'blocking', `${family} blocks on ui/3`);
  assert.match(profileNotices(profile)[0] ?? '', /^lint: report, its findings are listed but never count on branch ui\/3 \(branch profile ui\/\* \(a pattern covering ui\/3\) of/u);
  assert.equal(activeProfile(app.root, { GITHUB_REF: 'refs/heads/ui/7' }).profile, 'ui/*', 'a push to a covered branch');
  assert.equal(activeProfile(app.root, { GITHUB_BASE_REF: 'dev', GITHUB_HEAD_REF: 'ui/7' }).profile, 'ui/*', 'a pull request from it into dev');
  assert.equal(activeProfile(app.root, { GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'ui/7' }).profile, null, 'a pull request into main runs the full gate');
  assert.equal(activeProfile(app.root, { STARCI_DEFAULT_BRANCH: 'ui/3' }).profile, null, 'the default branch never takes a profile, even one a pattern covers');
  assert.equal(activeProfile(app.root, { GITHUB_REF: 'refs/heads/feature/3' }).profile, null, 'a branch no entry covers runs the full gate');
});

test('the profile is chosen from the branch the run judges: the checkout, a push, a pull request; a pull request into main and the default branch run the full gate', (t) => {
  const app = scratchApp(t, 'dev');
  assert.equal(activeProfile(app.root, {}).profile, 'dev', 'the checked-out branch');
  assert.equal(activeProfile(app.root, { GITHUB_REF: 'refs/heads/dev' }).profile, 'dev', 'a push to dev');
  assert.equal(activeProfile(app.root, { GITHUB_REF: 'refs/heads/main' }).profile, null, 'a push to main');
  assert.equal(activeProfile(app.root, { GITHUB_REF: 'refs/tags/v1.0.0' }).profile, null, 'a tag is no branch');
  const intoMain = activeProfile(app.root, { GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'dev', GITHUB_REF: 'refs/pull/7/merge' });
  assert.equal(intoMain.profile, null, 'a pull request into main always runs the full gate');
  assert.match(intoMain.source, /a pull request into main/u);
  assert.equal(activeProfile(app.root, { GITHUB_BASE_REF: 'release/next', GITHUB_HEAD_REF: 'dev' }).profile, 'dev', 'any other pull request is judged as its source branch');
  assert.equal(activeProfile(app.root, { STARCI_DEFAULT_BRANCH: 'dev' }).profile, null, "CI's default branch is never lowered");
  const profile = activeProfile(app.root, {});
  assert.deepEqual({ lint: profile.modes.lint, sonar: profile.modes.sonar, codecov: profile.modes.codecov }, { lint: 'report', sonar: 'report', codecov: 'blocking' });
  const modes = familyModes(profile);
  assert.equal(modes['sonar'], 'blocking', 'the one sonar family runs as the stricter of sonar and codecov');
  for (const family of ['hfs', 'types', 'wiring', 'db', 'secrets', 'format', 'test']) assert.equal(modes[family], 'blocking', `${family} blocks on dev`);
  const refused = scratchApp(t, 'dev', 'branches:\n  dev:\n    gates:\n      lint: report\n      types: report\n');
  assert.equal(activeProfile(refused.root, {}).profile, null, 'a refused declaration lowers nothing');
});

test('on dev, lint and sonar report: the lint findings are listed and never count; on main the same findings block', async (t) => {
  const many = 'export const x = [' + Array.from({ length: 25 }, () => '"BAD"').join(', ') + '];\n';
  for (const branch of ['dev', 'main']) {
    const app = scratchApp(t, branch);
    fs.writeFileSync(path.join(app.root, 'be', 'src', 'dirty.ts'), many);
    app.git('commit', '-q', '--amend', '-am', 'base: the old findings');
    fs.writeFileSync(path.join(app.root, 'NOTES.txt'), 'a commit that touches no source\n');
    app.git('add', 'NOTES.txt');
    app.git('commit', '-qm', 'notes');
    const run = await check(app, ['--gate', 'lint', '--json']);
    const lint = (run.report.findings as Doc[]).filter((finding) => finding.engine === 'eslint');
    assert.equal(lint.length, 25, `${branch}: every finding is listed`);
    if (branch === 'dev') {
      assert.equal(run.exit, 0, 'report: 25 lint findings never count');
      assert.ok(lint.every((finding) => finding.report === true));
      assert.equal(run.report.counts.reported, 25);
      assert.equal(run.report.branchProfile.profile, 'dev');
      assert.equal(run.report.branchProfile.notices.length, 1, 'the lint notice of a --gate lint run');
    } else {
      assert.equal(run.exit, 1, 'main: 25 findings are over the threshold');
      assert.equal(run.report.branchProfile.profile, null);
    }
  }
  const human = await check(scratchApp(t, 'dev'), ['--gate', 'lint']);
  assert.match(human.stdout, /lint: report, its findings are listed but never count on branch dev \(branch profile dev of \.starcistacks\/application-stacks\.yaml; the checked-out branch/u);
  assert.match(human.stdout, /\[ERROR, REPORT ONLY\] fixture\/no-bad x2/u);
});

test('on dev the hfs, secrets and db findings still block', async (t) => {
  const app = scratchApp(t, 'dev');
  const cases: [string, Record<string, unknown>[]][] = [
    ['secrets', [{ code: 'HFS_PLAINTEXT_SECRET', level: 'error', path: 'be/.env', message: 'a plaintext secret' }]],
    ['db', [{ code: 'DB_MIGRATION_SHAPE', level: 'error', path: 'be/migrations/1.sql', message: 'a broken migration' }]],
    ['hfs', Array.from({ length: 20 }, (_, index) => ({ code: 'HFS_MANAGED_FILE_DRIFT', level: 'error', path: `file-${String(index)}`, message: 'drift' }))],
  ];
  for (const [family, findings] of cases) {
    const run = await check(app, ['--json'], { findings });
    assert.equal(run.exit, 1, family);
    assert.ok((run.report.findings as Doc[]).filter((item) => !item.engine).every((item) => item.report !== true), `no ${family} finding is report-only`);
  }
});

test('lint off on dev does not run lint and says so; --profile prints the profile and the mode word the pre-commit hook reads', async (t) => {
  const app = scratchApp(t, 'dev', 'branches:\n  dev:\n    gates:\n      lint: off\n');
  const calls: { texts: number }[] = [];
  let linted = 0;
  const run = await check(app, ['--gate', 'lint', '--json'], { run: async (spec) => { linted += 1; return counting(calls)(spec); } });
  assert.equal(run.exit, 0);
  assert.equal(linted, 0, 'an off gate runs nothing, the ratchet neither');
  assert.match(run.report.branchProfile.notices[0], /^lint: off, not run on branch dev/u);
  assert.equal((await check(app, ['--profile', '--gate', 'lint'])).stdout, 'off\n');
  const dev = scratchApp(t, 'dev');
  assert.equal((await check(dev, ['--profile', '--gate', 'lint'])).stdout, 'report\n');
  assert.equal((await check(dev, ['--profile', '--gate', 'types'])).stdout, 'blocking\n');
  assert.equal((await check(dev, ['--profile', '--gate', 'lint'], { env: { GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'dev' } })).stdout, 'blocking\n', 'a pull request into main');
  assert.match((await check(dev, ['--profile'])).stdout, /^branch dev \(the checked-out branch[^\n]*\): branch profile dev\n {2}hfs blocking\n/u);
  assert.equal((await check(dev, ['--profile', '--fix'])).exit, 2, '--profile takes only --gate and --json');
});

test('the ratchet: touching a dirty file without adding findings passes, adding one fails, a new file with a finding fails (pre-commit and range)', async (t) => {
  const app = scratchApp(t, 'dev');
  const stage = (file: string, text: string): void => { fs.writeFileSync(path.join(app.root, file), text); app.git('add', file); };
  // pre-commit: the staged files against HEAD
  stage('be/src/dirty.ts', 'export const a = "BAD";\nexport const b = "BAD";\nexport const c = 2;\n');
  const kept = await check(app, ['--ratchet']);
  assert.equal(kept.exit, 0, kept.stdout);
  assert.match(kept.stdout, /1 staged file\(s\) compared with HEAD, 0 raised/u);
  stage('be/src/dirty.ts', 'export const a = "BAD";\nexport const b = "BAD";\nexport const c = "BAD";\n');
  const raised = await check(app, ['--ratchet']);
  assert.equal(raised.exit, 1);
  assert.match(raised.stdout, /LINT_RATCHET_RAISED be\/src\/dirty\.ts: 3 lint error finding\(s\), 2 at the base; on branch dev lint reports/u);
  app.git('reset', '-q', 'HEAD', '--', 'be/src/dirty.ts');
  app.git('checkout', '-q', '--', 'be/src/dirty.ts');
  stage('be/src/fresh.ts', 'export const n = "BAD";\n');
  const fresh = await check(app, ['--ratchet']);
  assert.equal(fresh.exit, 1);
  assert.match(fresh.stdout, /be\/src\/fresh\.ts: 1 lint error finding\(s\), it is new, so it carries none/u);
  stage('be/src/fresh.ts', 'export const n = 1;\n');
  assert.equal((await check(app, ['--ratchet'])).exit, 0, 'a clean new file passes');
  // the range of the pre-push hook and CI: the commits since the base, within the lint family of the check
  app.git('commit', '-qm', 'a clean new file');
  const calls: { texts: number }[] = [];
  const clean = await check(app, ['--gate', 'lint', '--json'], { run: counting(calls) });
  assert.equal(clean.exit, 0);
  assert.deepEqual(calls, [{ texts: 1 }], 'with no lint records (this fixture checks without the cache session), only the touched file is linted, once, as one text (new at the base)');
  fs.writeFileSync(path.join(app.root, 'be', 'src', 'clean.ts'), 'export const c = "BAD";\n');
  app.git('commit', '-qam', 'a finding added to a touched file');
  const pushed = await check(app, ['--gate', 'lint', '--json']);
  assert.equal(pushed.exit, 1, 'the ratchet blocks while the old findings report');
  const ratchet = (pushed.report.findings as Doc[]).filter((finding) => finding.code === 'LINT_RATCHET_RAISED');
  assert.deepEqual(ratchet.map((finding) => finding.path), ['be/src/clean.ts']);
  assert.equal(ratchet[0].report, undefined, 'a ratchet finding is never report-only');
  assert.equal(pushed.report.gate.pass, false, 'the ratchet finding turns the gate red');
  assert.equal((await check(app, ['--gate', 'lint', '--side', 'fe', '--json'])).exit, 0, 'a side the commits did not touch has nothing to ratchet');
  // the same commit judged on main (full gate): no ratchet, the plain lint verdict
  const main = await check(app, ['--gate', 'lint', '--json'], { env: { GITHUB_REF: 'refs/heads/main' } });
  assert.equal((main.report.findings as Doc[]).some((finding) => finding.code === 'LINT_RATCHET_RAISED'), false);
  assert.equal((await check(app, ['--ratchet'], { env: { GITHUB_REF: 'refs/heads/main' } })).stdout, 'lint is blocking on branch main: the lint ratchet applies only where a branch profile reports lint\n');
});

test('ESLint lints a text as the file it stands for through a typed config (lintText with filePath): the ratchet base is judged by the same program', async (t) => {
  const root = mkdtemp(t, 'starci-ratchet-eslint-');
  const own = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
  // The package's own install, linked in; the link is unlinked as a link before the folder goes (never a recursive delete through it).
  fs.symlinkSync(path.join(own, '..', 'node_modules'), path.join(root, 'node_modules'), 'junction');
  try {
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true,"type":"module"}');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022', strict: true, noEmit: true }, include: ['src'] }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'kind.ts'), 'export const kind = "BAD" as const;\n');
  fs.writeFileSync(path.join(root, 'src', 'use.ts'), 'export const fine = 1;\n');
  // A type-aware rule: a variable whose initialiser has the type "BAD", a type that comes from another file of the program.
  fs.writeFileSync(path.join(root, 'eslint.config.mjs'), [
    `import tsParser from ${JSON.stringify(pathToFileURL(path.join(own, '..', 'node_modules', '@typescript-eslint', 'parser', 'dist', 'index.js')).href)};`,
    'const rule = { meta: { type: "problem", schema: [], messages: { bad: "typed BAD" } }, create(context) { const services = context.sourceCode.parserServices; const checker = services.program.getTypeChecker();',
    '  return { VariableDeclarator(node) { if (node.init && checker.typeToString(checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node.init))) === \'"BAD"\') context.report({ node, messageId: "bad" }); } }; } };',
    'export default [{ files: ["src/**/*.ts"], languageOptions: { parser: tsParser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } }, plugins: { fixture: { rules: { typed: rule } } }, rules: { "fixture/typed": "error" } }];',
  ].join('\n'));
  // The CLI's admission of a heavy child is a plain spawn here.
  const execute: HeavyNodeRun = async (request) => {
    const child = spawnSync(process.execPath, request.args, { cwd: request.cwd, env: request.env ?? process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, ...(child.error ? { error: child.error } : {}) };
  };
  const linted = await runLinter({ cwd: root, pkg: 'eslint', bin: 'eslint', args: ['--format', 'json'], bound: root, texts: [
    { file: 'src/use.ts', text: 'import { kind } from "./kind";\nexport const a = kind;\nexport const b = kind;\n' },
    { file: 'src/use.ts', text: 'import { kind } from "./kind";\nexport const a = kind;\n' },
  ] }, execute);
  assert.equal(linted.error, undefined, linted.error);
  assert.deepEqual((linted.results ?? []).map((result: Doc) => [path.basename(result.filePath), result.messages.map((message: Doc) => message.ruleId)]),
    [['use.ts', ['fixture/typed', 'fixture/typed']], ['use.ts', ['fixture/typed']]], 'each text is judged as src/use.ts with the types of src/kind.ts, not as the file on disk');
  } finally { fs.unlinkSync(path.join(root, 'node_modules')); }
});

test('CI: a push to dev runs the reduced CI (sonar and codecov report, lint through the app check), main and a pull request into main the full gate', (t) => {
  const read = (yaml: string) => (file: string): string => { if (file === '../.starcistacks/application-stacks.yaml') return yaml; throw Object.assign(new Error('absent'), { code: 'ENOENT' }); };
  const dev = ciWorkflowCommands({ files: [], read: read(declaration('branches:\n  dev:\n    gates:\n      lint: report\n      sonar: report\n      codecov: report\n')) });
  assert.equal(dev['pushProfileBranches'], '      - "dev"');
  assert.match(dev['planBranchProfiles'] ?? '', /if \[\[ "\$EVENT" == push && "\$REF_TYPE" == branch \]\]; then\n {12}case "\$GITHUB_REF_NAME" in\n {14}"dev"\) sonar=report codecov=report note="branch profile dev: checks only; lint report, sonar report, codecov report/u);
  const none = ciWorkflowCommands({ files: [], read: read(declaration('')) });
  assert.deepEqual([none['pushProfileBranches'], none['planBranchProfiles']], ['', '']);
  const refused = ciWorkflowCommands({ files: [], read: read(declaration('branches:\n  main:\n    gates:\n      lint: report\n')) });
  assert.deepEqual([refused['pushProfileBranches'], refused['planBranchProfiles']], ['', ''], 'a refused profile renders nothing');
  for (const edition of ['full', 'lite']) {
    const source = { files: [], read: read(declaration(DEV)), stack: { images: [], passEnv: [], imageEnvironments: {}, environments: [], imageCache: 'gha' }, hasImage: () => true } as unknown as NonNullable<NonNullable<Parameters<typeof renderTargets>[2]>['source']>;
    const text = renderTargets({ ...structuredClone(APP), edition }, PRESETS, { source }).find((target) => target.path === '.github/workflows/ci.yml')?.content ?? '';
    const ci: Doc = parseWorkflow(text);
    assert.deepEqual(ci.on.push.branches, ['main', 'release/candidate-*', 'dev'], `${edition}: a push to dev starts CI`);
    assert.deepEqual(ci.on.pull_request, { branches: ['main'] }, 'a pull request targets main alone, so it runs the full gate');
    const plan = ci.jobs.plan.steps.find((step: Doc) => step.id === 'plan').run as string;
    assert.match(plan, /"dev"\) sonar=report codecov=blocking/u);
    assert.match(plan, /echo "sonar=\$sonar"; echo "codecov=\$codecov";/u);
    assert.equal(ci.jobs.sonar.if, "${{ needs.plan.outputs.full == 'true' || needs.plan.outputs.sonar == 'report' }}");
    assert.equal(ci.jobs.sonar.steps.find((step: Doc) => String(step.uses).startsWith('SonarSource/sonarqube-quality-gate-action@')).if, "${{ !cancelled() && needs.plan.outputs.full == 'true' }}", 'only a full run judges the quality gate');
    assert.match(ci.jobs.verdict.steps[0].run, /if \[\[ "\$CHECKS" == true && \( "\$FULL" == true \|\| "\$SONAR" == report \) \]\]; then expect sonar success; else expect sonar idle; fi/u);
    assert.match(ci.jobs.lint.steps.find((step: Doc) => /app check --gate lint/u.test(String(step.run))).run, /npx --no-install starci app check --gate lint --side \$\{\{ matrix\.side \}\}/u, 'the lint job takes the profile itself');
    // R251 takes the push of a profile branch only while the declaration gives it a profile.
    const root = mkdtemp(t, 'starci-branch-ci-');
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(root, '.starcistacks'));
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), text);
    const triggers = (): Doc[] => deployWorkflowFindings({ repoRoot: root, files: ['.github/workflows/ci.yml'], repo: { kind: 'app', edition }, isRoot: true }).filter((finding: Doc) => finding.code === 'HFS_APP_WORKFLOW_TRIGGER');
    fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), declaration(DEV));
    assert.deepEqual(triggers(), [], `${edition}: dev has a profile`);
    fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), declaration(''));
    assert.match(triggers()[0]?.message ?? '', /ci\.yml may also name main and the branches with a branch profile \(none declared\)/u);
  }
});

test('CI: a push to a branch a pattern covers runs the reduced plan; the plan matches the pattern as a case glob after the named branches', () => {
  const read = (yaml: string) => (file: string): string => { if (file === '../.starcistacks/application-stacks.yaml') return yaml; throw Object.assign(new Error('absent'), { code: 'ENOENT' }); };
  const commands = ciWorkflowCommands({ files: [], read: read(declaration('branches:\n  "ui/*":\n    gates:\n      lint: report\n      sonar: report\n  dev:\n    gates:\n      lint: report\n')) });
  assert.equal(commands['pushProfileBranches'], '      - "ui/*"\n      - "dev"');
  const plan = commands['planBranchProfiles'] ?? '';
  assert.ok(plan.indexOf('"dev") sonar=blocking') < plan.indexOf('"ui/"*) sonar=report'), plan);
  const script = `GITHUB_REF_NAME="$1"; sonar=blocking; case "$GITHUB_REF_NAME" in\n${plan.split('\n').filter((line) => /^\s+"/u.test(line)).join('\n')}\nesac; echo "$sonar"`;
  const run = (branch: string): string => spawnSync('bash', ['-c', script, 'plan', branch], { encoding: 'utf8' }).stdout.trim();
  assert.deepEqual(['ui/3', 'dev', 'main', 'uix'].map(run), ['report', 'blocking', 'blocking', 'blocking']);
});

test('the range ratchet trusts the lint records: a file the base cache and this run both hold with no rule risen needs no child; the rest is linted in bounded chunks', async (t) => {
  const app = scratchApp(t, 'dev');
  const many = Array.from({ length: RATCHET_TEXTS_PER_CHILD + 10 }, (_, index) => ({ file: `be/src/f${String(index)}.ts`, base: 'export const a = "BAD";\n', current: 'export const a = "BAD";\nexport const b = 1;\n' }));
  const touched = [...many, { file: 'be/src/rose.ts', base: 'export const a = 1;\n', current: 'export const a = "BAD";\n' }];
  const recorded = (pick: (file: { base: string; current: string }) => string, count: (text: string) => number): RecordedCounts => ({
    counts: (side, file, hash) => {
      const found = touched.find((entry) => entry.file === `${side}/${file}` && hashText(pick(entry)) === hash);
      return found === undefined ? undefined : new Map([['fixture/no-bad', count(pick(found))]]);
    },
  });
  const bad = (text: string): number => [...text.matchAll(/BAD/gu)].length;
  const calls: { texts: number }[] = [];
  const cached = await ratchetFindings({ repoRoot: app.root, touched, branch: 'dev', run: counting(calls), base: recorded((entry) => entry.base, bad), now: recorded((entry) => entry.current, bad) });
  assert.deepEqual([cached.fromCache, cached.linted, cached.findings.map((finding) => finding.path)], [RATCHET_TEXTS_PER_CHILD + 10, 1, ['be/src/rose.ts']], 'only the file whose records rose is linted, and it is judged by the linter');
  assert.deepEqual(calls, [{ texts: 2 }]);
  // Without records (a first push whose base holds no cache), the touched files are linted in chunks that never exceed the bound of one child.
  const bounded: { texts: number }[] = [];
  const cold = await ratchetFindings({ repoRoot: app.root, touched, branch: 'dev', run: counting(bounded) });
  assert.equal(cold.fromCache, 0);
  assert.equal(cold.compared, touched.length);
  assert.ok(bounded.length > 1 && bounded.every((call) => call.texts <= RATCHET_TEXTS_PER_CHILD), JSON.stringify(bounded));
  assert.deepEqual(cold.findings.map((finding) => finding.path), ['be/src/rose.ts']);
});

test('a child that ends without a measurement is named with its cause: the heap it ran out of, the signal, the spawn error', () => {
  assert.throws(() => completedNode({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' }, 'eslint in be/ (the lint ratchet, 1200 text(s))'),
    /^Error: eslint in be\/ \(the lint ratchet, 1200 text\(s\)\) did not complete: killed by SIGKILL with no message of its own: most often the out-of-memory killer/u);
  assert.match(incompleteReason({ status: null, signal: 'SIGABRT', stderr: '<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n' }), /^it ran out of JavaScript heap .*, SIGABRT; stderr: .*Reached heap limit/u);
  assert.match(incompleteReason({ status: null, signal: null, stderr: '', error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }) }), /^ETIMEDOUT: deadline$/u);
  assert.equal(incompleteReason({ status: null, signal: null, stderr: '' }), 'it ended without an exit status');
});

test('the lint records the ratchet trusts: the committed cache at a commit, read from git, and the records of this run, each by side, path and content hash', (t) => {
  const app = scratchApp(t, 'dev');
  const text = 'export const a = "BAD";\n';
  const record = { path: 'src/a.ts', step: 'eslint', hash: hashText(text), findings: [{ path: 'be/src/a.ts', line: 1, column: 1, rule: 'fixture/no-bad', message: 'BAD' }], data: { ends: [] } };
  fs.mkdirSync(path.join(app.root, '.starcistacks', 'cache', 'lint', 'be', 'src'), { recursive: true });
  fs.writeFileSync(path.join(app.root, '.starcistacks', 'cache', 'lint', 'be', 'src.jsonl'), `${JSON.stringify(record)}\n`);
  app.git('add', '-f', '.starcistacks/cache/lint');
  app.git('commit', '-qm', 'the cache');
  const head = app.git('rev-parse', 'HEAD').trim();
  const committed = committedLintCounts(app.root, head);
  assert.deepEqual([...(committed.counts('be', 'src/a.ts', hashText(text)) ?? [])], [['fixture/no-bad', 1]]);
  assert.equal(committed.counts('be', 'src/a.ts', hashText('other')), undefined, 'a record of another content stands for nothing');
  assert.equal(committedLintCounts(app.root, null).counts('be', 'src/a.ts', hashText(text)), undefined);
  const run = sessionLintCounts((folder) => (folder === 'lint/be' ? [record] : []));
  assert.deepEqual([...(run.counts('be', 'src/a.ts', hashText(text)) ?? [])], [['fixture/no-bad', 1]]);
  assert.equal(run.counts('fe', 'src/a.ts', hashText(text)), undefined);
});
