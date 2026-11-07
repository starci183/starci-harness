import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { main } from './main.mjs';
import type { LinterRunner } from '../lint/run.mjs';

const familyCode = 'FE_APP_SHELL_FRAME';

interface Fixture { root: string; files: Record<string, string[]>; entries: Record<string, string> }
interface Run { side: string; args: string[] }
/** The fields of the CLI's JSON report this spec reads. */
interface Report {
  ok: boolean;
  gate: { pass: boolean; count: number; line: string | null };
  counts: { error: number; warning?: number; info?: number };
  counting?: Record<string, number>;
  findings: { code: string; rule?: string; severity?: string; level?: string }[];
  eslint: { sides: unknown; errors: unknown };
}

function installedPackage(root: string, name: string, source: string) {
  const directory = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(path.join(directory, 'index.mjs'), source);
  return pathToFileURL(path.join(directory, 'index.mjs')).href;
}

function fixture(context: TestContext): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-check-eslint-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'fixture', sides: {
    be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] },
  } }));
  const files: Record<string, string[]> = { be: ['src/backend.ts'], fe: ['src/universal.ts', 'src/family.tsx'] };
  const entries: Record<string, string> = {};
  for (const side of ['be', 'fe']) {
    const cwd = path.join(root, side);
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    for (const file of files[side]!) fs.writeFileSync(path.join(cwd, file), 'export const value = 1;\n');
    const factory = side === 'be' ? 'starciBeConfig' : 'starciFeConfig';
    entries[side] = installedPackage(root, `@starci/eslint-canon-${side}`, [
      "import fs from 'node:fs';", "import path from 'node:path';", "import { fileURLToPath } from 'node:url';",
      `export const loadHfs = url => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(url)), '../hfs.json'), 'utf8')).sides.${side};`,
      'export let calls = 0;',
      `export const ${factory} = () => { calls++; return [{ files: ['src/**/*.ts'], settings: { universal: '${side}' } }]; };`,
    ].join('\n'));
    fs.writeFileSync(path.join(cwd, 'eslint.config.mjs'), [
      `import { loadHfs, ${factory} } from '@starci/eslint-canon-${side}';`,
      ...(side === 'fe' ? ["import { coreGrammarConfig } from '@starci/eslint-grammar-core';"] : []),
      'const hfs = loadHfs(import.meta.url);',
      `export default [...${factory}({ hfs })${side === 'fe' ? ', ...coreGrammarConfig({ hfs })' : ''}];`,
    ].join('\n'));
  }
  entries.family = installedPackage(root, '@starci/eslint-grammar-core', [
    'export let calls = 0;',
    "export const coreGrammarConfig = ({ hfs }) => { if(hfs.grammar !== 'core') throw new Error('wrong family'); calls++; return [{ files: ['src/**/*.tsx'], settings: { family: 'core' } }]; };",
  ].join('\n'));
  return { root, files, entries };
}

const cleanCheck = (root: string, findings: Record<string, unknown>[] = []) => ({ ok: findings.length === 0, repoRoot: root, profile: 'app', manifest: '3.4.0', tracked: 3,
  findings, counts: { error: findings.length, warning: 0, info: 0 }, machine: { status: 'ran', files: 3, kinds: ['backend', 'frontend'] } });

function transport(fixture: Fixture, calls: Run[]): LinterRunner {
  return async ({ cwd, pkg, args: options, list }) => {
    assert.equal(pkg, 'eslint');
    const side = path.basename(cwd);
    const args = [...options, ...(list ?? [])];
    calls.push({ side, args });
    const universal = await import(fixture.entries[side]!);
    const family = side === 'fe' ? await import(fixture.entries['family']!) : null;
    const before = { universal: universal.calls, family: family?.calls };
    const { default: config } = await import(pathToFileURL(path.join(cwd, 'eslint.config.mjs')).href);
    assert.equal(universal.calls - before.universal, 1, 'one universal factory call in the ESLint invocation');
    if (family) {
      assert.equal(family.calls - before.family, 1, 'one family factory call in the same ESLint invocation');
      assert.deepEqual(config.map((block: { settings: unknown }) => block.settings), [{ universal: 'fe' }, { family: 'core' }]);
    }
    const selected = args.at(-1) === '.' ? fixture.files[side]! : fixture.files[side]!.filter((file) => args.includes(file));
    return { results: selected.map((file) => ({ filePath: path.join(cwd, file), messages: file.endsWith('family.tsx')
      ? [{ ruleId: 'starci-grammar/app-shell-frame', message: `[${familyCode}] Fixed frame is required.`, line: 1, column: 1 }]
      : [] })) };
  };
}

async function invoke(argv: string[], fixture: Fixture, checkApp: (args: { repoRoot: string; fast?: boolean }) => unknown, runLinter: LinterRunner) {
  let stdout = '', stderr = '';
  const exit = await main([...argv, '--json'], { cwd: fixture.root, checkApp, runLinter,
    stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
  assert.equal(stderr, '');
  return { exit, report: JSON.parse(stdout) as Report };
}

test('CLI app check executes both FE packages in one ESLint invocation, retains HFS findings and reports the family code', async context => {
  const app = fixture(context), runs: Run[] = [];
  let checks = 0;
  const checked = await invoke(['check'], app, ({ repoRoot }) => {
    checks++;
    return cleanCheck(repoRoot, [{ code: 'HFS_MANAGED_FILE_DRIFT', level: 'error', path: 'package.json', message: 'Managed output differs.' }]);
  }, transport(app, runs));
  assert.equal(checks, 1);
  assert.deepEqual(runs.map(run => run.side), ['be', 'fe']);
  // Two error findings make the gate red, and both stay reported.
  assert.equal(checked.exit, 1);
  assert.equal(checked.report.ok, false);
  assert.equal(checked.report.gate.pass, false);
  assert.equal(checked.report.gate.line, 'gate: red, 2 error finding(s)');
  assert.equal(checked.report.counts.error, 2);
  assert.deepEqual(checked.report.findings.map(finding => finding.code), ['HFS_MANAGED_FILE_DRIFT', familyCode]);
  assert.equal(checked.report.findings[1]!.rule, 'starci-grammar/app-shell-frame');
  assert.deepEqual(checked.report.eslint.sides, { be: { files: 1 }, fe: { files: 2 } });
});

test('app check --gate lint --side fe runs the shared ESLint execution of that side once and calls the in-process HFS checker once', async context => {
  const app = fixture(context), runs: Run[] = [];
  let checks = 0;
  const checked = await invoke(['check', '--gate', 'lint', '--side', 'fe'], app, ({ repoRoot }) => { checks++; return cleanCheck(repoRoot); }, transport(app, runs));
  assert.equal(checks, 1);
  assert.deepEqual(runs.map(run => run.side), ['fe']);
  assert.equal(checked.exit, 1, 'one error finding makes the gate red');
  assert.equal(checked.report.gate.pass, false);
  assert.deepEqual(checked.report.findings.map(finding => finding.code), [familyCode]);
  assert.deepEqual(checked.report.eslint.sides, { fe: { files: 2 } });
});

test('app check --gate lint --side be judges the back end alone, and a scope that is none of be, fe and packages is a usage error with the usage', async context => {
  const app = fixture(context), runs: Run[] = [];
  const checked = await invoke(['check', '--gate', 'lint', '--side', 'be'], app, ({ repoRoot }) => cleanCheck(repoRoot), transport(app, runs));
  assert.deepEqual(runs.map(run => run.side), ['be']);
  assert.deepEqual(checked.report.findings, []);
  let stderr = '';
  const exit = await main(['check', '--gate', 'lint', '--side', 'web'], { cwd: app.root, checkApp: ({ repoRoot }) => cleanCheck(repoRoot), runLinter: transport(app, []), stdout: () => undefined, stderr: (text) => { stderr += text; } });
  assert.equal(exit, 2);
  assert.match(stderr, /^starci app: LINT_SIDE_INVALID: --side is be, fe or packages\n/);
  assert.match(stderr, /^starci app check /m, 'a usage error is followed by the usage');
});

test('app check --fix runs ESLint and stylelint with --fix before the check, and is refused unless --gate lint is selected', async context => {
  const app = fixture(context);
  const calls: { pkg: string; args: string[] }[] = [];
  const run: LinterRunner = async (spec) => {
    calls.push({ pkg: spec.pkg, args: spec.args });
    return { results: spec.pkg === 'eslint' ? app.files[path.basename(spec.cwd)]!.map((file) => ({ filePath: path.join(spec.cwd, file), messages: [] })) : [] };
  };
  const checked = await invoke(['check', '--gate', 'lint', '--fix', '--side', 'fe'], app, ({ repoRoot }) => cleanCheck(repoRoot), run);
  assert.deepEqual(calls.map(call => [call.pkg, call.args.includes('--fix')]), [['eslint', true], ['stylelint', true], ['eslint', false]], 'the fixing pass comes first, the judging pass after it');
  assert.deepEqual(checked.report.eslint.errors, []);
  assert.equal(checked.exit, 0);
  let stderr = '';
  const exit = await main(['check', '--fix'], { cwd: app.root, checkApp: ({ repoRoot }) => cleanCheck(repoRoot), runLinter: run, stdout: () => undefined, stderr: (text) => { stderr += text; } });
  assert.equal(exit, 2);
  assert.match(stderr, /^starci app: --fix runs the linters and needs --gate lint\n/);
  assert.equal(calls.length, 3, 'a refused --fix runs no linter');
});

test('app check --out writes the merged Sonar import of every finding the run produced', async context => {
  const app = fixture(context);
  const target = path.join(app.root, 'reports', 'lint.fe.sonar.json');
  const checked = await invoke(['check', '--gate', 'lint', '--side', 'fe', '--out', 'reports/lint.fe.sonar.json'], app, ({ repoRoot }) => cleanCheck(repoRoot, [{ code: 'HFS_MANAGED_FILE_DRIFT', level: 'error', path: 'fe/package.json', message: 'Managed output differs.' }]), transport(app, []));
  assert.equal(checked.exit, 1, 'the findings it writes are errors, so the gate is red');
  const document = JSON.parse(fs.readFileSync(target, 'utf8')) as { rules: { id: string; engineId: string }[]; issues: { ruleId: string; primaryLocation: { filePath: string } }[] };
  assert.deepEqual(document.rules.map(rule => [rule.engineId, rule.id]).sort(), [['eslint', 'starci-grammar/app-shell-frame'], ['starci-hfs', 'HFS_MANAGED_FILE_DRIFT']]);
  assert.ok(document.issues.some(issue => issue.ruleId === 'starci-grammar/app-shell-frame' && issue.primaryLocation.filePath === 'fe/src/family.tsx'));
});

test('a refusal or a tool failure prints its code and message alone; only a usage error is followed by the usage', async context => {
  const app = fixture(context);
  const failed = async (checkApp: () => unknown) => {
    let stderr = '';
    const exit = await main(['check', '--gate', 'lint'], { cwd: app.root, checkApp, runLinter: transport(app, []), stdout: () => undefined, stderr: (text) => { stderr += text; } });
    return { exit, stderr };
  };
  const tool = await failed(() => { throw new Error('HFS_NODE_INCOMPLETE: eslint did not complete'); });
  assert.deepEqual(tool, { exit: 2, stderr: 'starci app: HFS_NODE_INCOMPLETE: eslint did not complete\n' });
  let stderr = '';
  assert.equal(await main(['check', '--nope'], { cwd: app.root, stdout: () => undefined, stderr: (text) => { stderr += text; } }), 2);
  assert.match(stderr, /^starci app: unknown flag --nope\nstarci app scaffold /);
});

test('CLI app check refuses an unavailable ESLint transport with exit 2 and preserves its tool errors', async context => {
  const app = fixture(context), runs: string[] = [];
  const checked = await invoke(['check'], app, ({ repoRoot }) => cleanCheck(repoRoot), async ({ cwd }) => {
    runs.push(path.basename(cwd));
    return { error: 'ESLint transport did not complete.' };
  });
  assert.deepEqual(runs, ['be', 'fe']);
  assert.equal(checked.exit, 2);
  assert.equal(checked.report.ok, false);
  assert.deepEqual(checked.report.eslint.errors, ['ESLint transport did not complete.', 'ESLint transport did not complete.']);
});


test('a counting-cohort warning is reported and counted per rule and never enters the verdict, however many there are', async context => {
  const app = fixture(context), runs: Run[] = [];
  const base = transport(app, runs);
  const warning = { ruleId: 'starci-fe/no-spacing-utility', severity: 1, message: '`gap-4` writes a distance the Grammar owns.', line: 2, column: 1 };
  const counting: LinterRunner = async (spec) => {
    const run = await base(spec);
    return { results: (run.results ?? []).map((result: { filePath: string; messages: unknown[] }) => ({ ...result, messages: [...result.messages, ...Array.from({ length: 25 }, () => warning)] })) };
  };
  const checked = await invoke(['check', '--gate', 'lint', '--side', 'be'], app, ({ repoRoot }) => cleanCheck(repoRoot), counting);
  assert.equal(checked.exit, 0, 'warnings never enter the verdict, however many there are');
  assert.equal(checked.report.gate.pass, true);
  assert.deepEqual(checked.report.counts, { error: 0, warning: 25, info: 0 });
  assert.deepEqual(checked.report.counting, { 'starci-fe/no-spacing-utility': 25 });
  assert.equal(checked.report.findings.filter(finding => finding.severity === 'warning').length, 25);
  assert.equal(checked.report.findings.filter(finding => finding.severity === 'warning' && finding.level === 'warning').length, 25, 'a counting-cohort finding is a warning, never an error');
});


for (const code of ['HOST_HELD', 'CLI_TOOL_INCOMPLETE', 'HFS_NODE_GOVERNOR_MISSING', 'HEAVY_DEFERRED']) {
  test(`app check preserves ${code} through a single child catch and settles the sibling child`, async context => {
    const app = fixture(context);
    const refusal = Object.assign(new Error('execution reached no verdict'), { code, exitCode: code === 'HOST_HELD' ? 75 : 2 });
    const base = transport(app, []);
    let siblingSettled = false;
    let stdout = '';
    const exit = await main(['check', '--gate', 'lint', '--json'], {
      cwd: app.root, checkApp: ({ repoRoot }) => cleanCheck(repoRoot),
      runLinter: async spec => {
        if (path.basename(spec.cwd) === 'be') throw refusal;
        await Promise.resolve();
        siblingSettled = true;
        return base(spec);
      },
      stdout: text => { stdout += text; }, stderr: () => undefined,
    });
    assert.equal(exit, code === 'HOST_HELD' ? 75 : 2);
    assert.equal(siblingSettled, true);
    assert.equal(stdout, '', 'a refused execution is not a completed JSON gate report');
  });
}

test('a run that does not run the Sonar scan prints one line saying why, in the text report and in the JSON predictions', async context => {
  const app = fixture(context);
  const run = async (argv: string[]) => {
    let stdout = '';
    await main(argv, { cwd: app.root, checkApp: ({ repoRoot }) => cleanCheck(repoRoot), runLinter: transport(app, []), stdout: (text) => { stdout += text; }, stderr: () => undefined });
    return stdout;
  };
  const selected = await run(['check', '--gate', 'lint']);
  assert.equal(selected.split('\n').filter((line) => line.includes('sonar scan:')).length, 1);
  assert.match(selected, /^ {2}sonar scan: not run, only a run with no selector, flag or --gate \(a whole run\) runs it$/m);
  const whole = await run(['check']);
  assert.match(whole, /^ {2}sonar scan: not run, this run keeps no check cache session$/m);
  const json = JSON.parse(await run(['check', '--gate', 'lint', '--json'])) as { predictions: string[] };
  assert.equal(json.predictions.length, 1);
});
