// proves: HFS_EXT_INVALID@lite
// proves: HFS_EXT_INVALID@full
// proves: HFS_EXT_API_MISMATCH@lite
// proves: HFS_EXT_API_MISMATCH@full
// The project extension folder (PROJECT-LINT-3, R381): a project adds its own laws in ext/ at the app root, declared in ext/manifest.json. The app
// check runs its machine rules under the rules' own codes (its project checks are R402, project-checks.spec.mts), the canon factories load its ESLint rules, and an extension that
// tries to do anything but add a rule, declares what is not there or targets another API version lends nothing while the check is red.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_EXT_API, PROJECT_EXT_API_MISMATCH, PROJECT_EXT_INVALID, extEslintConfigs, loadProjectExt, projectExtFindings } from '../runtime/scripts/lib/project-ext.mjs';
import { projectExtCheckFindings, reservedCodes } from '../runtime/scripts/hfs/rules/app-extension-findings.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

type Rule = Record<string, unknown>;
const SHAPE: Rule = { id: 'ACME-SHAPE-1', code: 'ACME_SHAPE_INCOMPLETE', severity: 'error', doc: 'ext/docs/ACME-SHAPE-1.md', appliesTo: ['packages/ui/src/**'], hfs: 'shape.mjs' };
const PROP: Rule = { id: 'ACME-PROP-1', code: 'ACME_PROP_ESCAPE', severity: 'warning', doc: 'https://example.invalid/acme-prop-1', appliesTo: ['fe/src/**/*.tsx', 'packages/ui/src/**/*.tsx'], lint: { tool: 'eslint', file: 'no-children-prop.mjs' } };
const OTHER: Rule = { id: 'ACME-SHAPE-2', code: 'ACME_SHAPE_OTHER', severity: 'warning', doc: 'ext/docs/ACME-SHAPE-1.md', appliesTo: ['be/src/**'], hfs: 'other.mjs' };
const GENERATED = { id: 'generated', run: 'ext/checks/generate.mjs', why: 'the generated list matches its source' };
const SOUND = [SHAPE, PROP, OTHER];

/** An app at a temp root with the extension `manifest` (an object, or raw text), its three modules, its doc and two package files. */
function app(t: TestContext, { rules = SOUND, checks = [GENERATED], manifest, files = {} }: { rules?: unknown; checks?: unknown; manifest?: unknown; files?: Record<string, string | null> } = {}): string {
  const root = mkdtemp(t, 'starci-project-ext-');
  const write = (file: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('package.json', '{"private":true}\n');
  write('hfs.json', JSON.stringify({ hfs: 3, kind: 'app', project: 'acme', sides: { be: { apps: [] }, fe: { apps: [] } } }));
  const declared = manifest === undefined ? { schema: 'starci/project-ext@1', api: PROJECT_EXT_API, rules, ...(checks === undefined ? {} : { checks }) } : manifest;
  write('ext/manifest.json', typeof declared === 'string' ? declared : JSON.stringify(declared));
  write('ext/hfs/shape.mjs', "export default (context) => context.files.filter((file) => file.endsWith('.ts') && !(context.read(file) ?? '').includes('schema')).map((file) => ({ path: file, line: 1, message: file + ' has no schema' }));\n");
  write('ext/hfs/other.mjs', 'export default () => [];\n');
  write('ext/lint/no-children-prop.mjs', "export default { meta: { type: 'problem' }, create: () => ({}) };\n");
  write('ext/checks/generate.mjs', "process.stdout.write('compared\\n');\n");
  write('ext/docs/ACME-SHAPE-1.md', '# ACME-SHAPE-1\n');
  write('packages/ui/src/card.ts', 'export const card = 1;\n');
  write('packages/ui/src/list.ts', 'export const schema = 1;\n');
  write('be/src/main.ts', 'export const main = 1;\n');
  for (const [file, text] of Object.entries(files)) { if (text === null) fs.rmSync(path.join(root, file)); else write(file, text); }
  return root;
}

const tracked = ['hfs.json', 'ext/manifest.json', 'packages/ui/src/card.ts', 'packages/ui/src/list.ts', 'be/src/main.ts'];
const read = (root: string) => (file: string): string | null => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
const problems = (root: string): string[] => loadProjectExt(root, reservedCodes()).problems.map((problem) => problem.message);
const repoOf = (edition: string) => ({ kind: 'app', profile: 'app', edition });

test('a sound extension lends its rules: the machine rule judges the tracked files its appliesTo names, under its own code and severity, with its id and doc', (t) => {
  const root = app(t);
  const ext = loadProjectExt(root, reservedCodes());
  assert.deepEqual(ext.problems, []);
  assert.deepEqual(ext.rules.map((rule) => [rule.id, rule.code, rule.severity, rule.hfs !== undefined, rule.lint?.name ?? null]), [
    ['ACME-SHAPE-1', 'ACME_SHAPE_INCOMPLETE', 'error', true, null],
    ['ACME-PROP-1', 'ACME_PROP_ESCAPE', 'warning', false, 'no-children-prop'],
    ['ACME-SHAPE-2', 'ACME_SHAPE_OTHER', 'warning', true, null],
  ]);
  assert.deepEqual(ext.checks, [GENERATED], 'the project checks the manifest declares, for the checks step (R402)');
  // be/src/main.ts has no schema either, and the rule never sees it: its reach is its declared paths
  assert.deepEqual(projectExtFindings({ repoRoot: root, files: tracked, reserved: reservedCodes(), read: read(root) }), [
    { code: 'ACME_SHAPE_INCOMPLETE', level: 'error', path: 'packages/ui/src/card.ts', line: 1, message: 'packages/ui/src/card.ts has no schema (ACME-SHAPE-1, ext/docs/ACME-SHAPE-1.md)' },
  ]);
  for (const edition of ['lite', 'full']) {
    const found = projectExtCheckFindings({ repoRoot: root, files: tracked, repo: repoOf(edition), isRoot: true });
    assert.deepEqual(found.map((finding) => [finding.code, finding.path, finding.level]), [['ACME_SHAPE_INCOMPLETE', 'packages/ui/src/card.ts', 'error']]);
    assert.deepEqual(projectExtCheckFindings({ repoRoot: root, files: tracked, repo: repoOf(edition), isRoot: false }), []);
  }
});

test('an app without an ext/ folder has no extension and no finding', (t) => {
  const root = app(t);
  fs.rmSync(path.join(root, 'ext'), { recursive: true });
  assert.deepEqual(loadProjectExt(root), { present: false, rules: [], checks: [], packages: {}, problems: [] });
  assert.deepEqual(projectExtCheckFindings({ repoRoot: root, files: tracked, repo: repoOf('lite'), isRoot: true }), []);
  assert.deepEqual(extEslintConfigs(path.join(root, 'fe'), 'fe'), []);
});

test('the canon factories load the lint rules of the extension over the files its appliesTo names inside each config, at the rule\'s severity', (t) => {
  const root = app(t);
  const fe = extEslintConfigs(path.join(root, 'fe'), 'fe');
  assert.deepEqual(fe.map((block) => [block.files, Object.keys(block.plugins), block.rules]), [[['src/**/*.tsx'], ['project-ext'], { 'project-ext/no-children-prop': 'warn' }]]);
  assert.equal(typeof fe[0]?.plugins['project-ext']?.rules['no-children-prop']?.create, 'function');
  const packages = extEslintConfigs(root, 'packages');
  assert.deepEqual(packages.map((block) => [block.files, block.rules]), [[['packages/ui/src/**/*.tsx'], { 'project-ext/no-children-prop': 'warn' }]]);
  assert.equal(packages[0]?.plugins['project-ext'], fe[0]?.plugins['project-ext'], 'one plugin object for every block');
  assert.deepEqual(extEslintConfigs(path.join(root, 'be'), 'be'), [], 'no lint rule of the extension reaches be/');
});

test(`${PROJECT_EXT_INVALID}: an extension only adds; a rule that turns off, overrides or reuses a code, or lacks its doc, its reach or its engine, refuses the whole extension`, (t) => {
  const refused = (rules: unknown, expected: RegExp, extra: Parameters<typeof app>[1] = {}): void => {
    const root = app(t, { rules, ...extra });
    const found = problems(root);
    assert.ok(found.some((message) => expected.test(message)), `${String(expected)} not in ${JSON.stringify(found)}`);
    assert.deepEqual(loadProjectExt(root, reservedCodes()).rules, [], 'a refused extension lends nothing');
    const findings = projectExtCheckFindings({ repoRoot: root, files: tracked, repo: repoOf('lite'), isRoot: true, inScope: () => false });
    assert.ok(findings.length > 0 && findings.every((finding) => finding.code === PROJECT_EXT_INVALID && finding.level === 'error' && finding.path === 'ext/manifest.json'), 'the refusal is red whatever the path scope');
    assert.throws(() => extEslintConfigs(path.join(root, 'fe'), 'fe'), /HFS_EXT_INVALID: ext\/manifest\.json /u, 'a lint run never guesses');
  };
  refused([{ ...SHAPE, off: ['R26'] }], /rule 0 has off: an extension only adds rules, it never turns one off, overrides or lowers it/u);
  refused([{ ...SHAPE, overrides: { R26: 'warn' } }], /has overrides/u);
  refused([{ ...SHAPE, severity: 'off' }], /severity must be error or warning/u);
  refused([{ ...SHAPE, code: 'HFS_EXT_INVALID' }], /HFS_EXT_INVALID is a code the harness reports/u);
  refused([SHAPE, { ...OTHER, id: 'ACME-SHAPE-1' }], /ACME-SHAPE-1: the id is declared twice/u);
  refused([SHAPE, { ...OTHER, code: 'ACME_SHAPE_INCOMPLETE' }], /ACME_SHAPE_INCOMPLETE is the code of another rule too/u);
  refused([{ ...SHAPE, doc: 'docs/elsewhere.md' }], /doc must be a file below ext\//u);
  refused([{ ...SHAPE, appliesTo: [] }], /appliesTo must list the app-relative globs/u);
  refused([{ ...SHAPE, appliesTo: ['**/*.ts'] }], /must start at a named folder or file of the app root/u);
  refused([{ ...SHAPE, appliesTo: ['../other/**'] }], /is not an app-relative path glob/u);
  refused([{ ...SHAPE, lint: PROP['lint'] }], /exactly one engine/u);
  refused([{ ...SHAPE, hfs: undefined }], /exactly one engine/u);
  refused([{ ...PROP, lint: { tool: 'stylelint', file: 'no-children-prop.mjs' } }], /lint\.tool must be eslint/u);
  refused([{ ...SHAPE, hfs: undefined, check: { command: ['node', 'ext/checks/generate.mjs'] } }], /rule 0 has check: an extension only adds rules/u);
  refused([SHAPE], /has disable: an extension holds only schema, api, rules, checks, packages/u, { manifest: { schema: 'starci/project-ext@1', api: PROJECT_EXT_API, rules: [SHAPE], disable: ['R26'] } });
  refused([], /is not a starci\/project-ext@1 manifest/u, { manifest: { schema: 'starci/rule-pack@1', api: PROJECT_EXT_API, rules: [SHAPE] } });
  refused([], /cannot be read as JSON/u, { manifest: '{ not json' });
  refused([], /declares no rule, no check and no package/u, { manifest: { schema: 'starci/project-ext@1', api: PROJECT_EXT_API, rules: [] } });
});

test(`${PROJECT_EXT_INVALID}: a declared rule or check that cannot be found is red, and so is a rule file no rule declares`, (t) => {
  const missing = (file: string, expected: RegExp): void => {
    const root = app(t, { files: { [file]: null } });
    assert.ok(problems(root).some((message) => expected.test(message)), `${String(expected)} not in ${JSON.stringify(problems(root))}`);
    assert.deepEqual(projectExtCheckFindings({ repoRoot: root, files: tracked, repo: repoOf('full'), isRoot: true }).map((finding) => finding.code).filter((code) => code !== PROJECT_EXT_INVALID), []);
  };
  missing('ext/hfs/shape.mjs', /ACME-SHAPE-1: ext\/hfs\/shape\.mjs is declared and is not there/u);
  missing('ext/lint/no-children-prop.mjs', /ACME-PROP-1: ext\/lint\/no-children-prop\.mjs is declared and is not there/u);
  missing('ext/checks/generate.mjs', /check generated: ext\/checks\/generate\.mjs is declared and is not there/u);
  missing('ext/manifest.json', /cannot be read as JSON/u);
  const stray = app(t, { files: { 'ext/hfs/forgotten.mjs': 'export default () => [];\n' } });
  assert.ok(problems(stray).some((message) => /ext\/hfs\/forgotten\.mjs is declared by no rule of the manifest/u.test(message)));
  const broken = app(t, { files: { 'ext/hfs/shape.mjs': 'export default 1;\n' } });
  assert.ok(problems(broken).some((message) => /must export by default a function \(context\) => findings/u.test(message)));
  const throwing = app(t, { files: { 'ext/hfs/shape.mjs': "export default () => { throw new Error('boom'); };\n" } });
  assert.deepEqual(projectExtFindings({ repoRoot: throwing, files: tracked, reserved: reservedCodes(), read: read(throwing) }).map((finding) => [finding.code, /ACME-SHAPE-1 threw \(boom\)/u.test(finding.message)]), [[PROJECT_EXT_INVALID, true]]);
  const pathless = app(t, { files: { 'ext/hfs/shape.mjs': "export default () => [{ message: 'no path' }];\n" } });
  assert.deepEqual(projectExtFindings({ repoRoot: pathless, files: tracked, reserved: reservedCodes(), read: read(pathless) }).map((finding) => finding.code), [PROJECT_EXT_INVALID]);
});

test(`${PROJECT_EXT_API_MISMATCH}: the extension API is versioned; a manifest of another version is refused and the finding names the project to update`, (t) => {
  const older = app(t, { manifest: { schema: 'starci/project-ext@1', api: PROJECT_EXT_API + 1, rules: SOUND } });
  const found = projectExtCheckFindings({ repoRoot: older, files: tracked, repo: repoOf('lite'), isRoot: true });
  assert.deepEqual(found.map((finding) => [finding.code, finding.level, finding.path]), [[PROJECT_EXT_API_MISMATCH, 'error', 'ext/manifest.json']]);
  assert.match(found[0]?.message ?? '', new RegExp(`project acme targets extension API ${String(PROJECT_EXT_API + 1)} and this @starci/hfs serves API ${String(PROJECT_EXT_API)}`, 'u'));
  assert.throws(() => extEslintConfigs(path.join(older, 'fe'), 'fe'), /HFS_EXT_API_MISMATCH: /u);
  const unversioned = app(t, { manifest: { schema: 'starci/project-ext@1', rules: SOUND } });
  assert.ok(problems(unversioned).some((message) => /api must be the extension API version/u.test(message)));
});

test('hfs.json holds no extension key: rulePacks is refused with the place the laws live now', () => {
  const found = declarationShapeProblems({ hfs: 3, kind: 'app', project: 'acme', rulePacks: ['@acme/hfs-rules'], sides: { be: { apps: [] }, fe: { apps: [] } } }, ['be', 'fe']);
  assert.ok(found.some((problem) => /unknown key rulePacks: a project adds its own laws and checks in its ext\/ folder/u.test(problem)), JSON.stringify(found));
});

test('a finding under an extension rule\'s own code is reported like any other: its why is the rule\'s id and doc, and a code nobody declares is still refused', async (t) => {
  const { readWhy } = await import('../runtime/scripts/hfs/check.mjs');
  const { withWhy } = await import('../runtime/scripts/hfs/check-results.mjs');
  assert.throws(() => readWhy(undefined, ['ACME_NOBODY_DECLARED']), /has no entry for ACME_NOBODY_DECLARED/u);
  const root = app(t);
  const found = projectExtCheckFindings({ repoRoot: root, files: tracked, repo: repoOf('lite'), isRoot: true });
  const why = readWhy(undefined, [...new Set(found.map((finding) => finding.code))]);
  const told = withWhy(found, why);
  assert.deepEqual(told.map((finding) => [finding.code, finding.title]), [['ACME_SHAPE_INCOMPLETE', 'ACME-SHAPE-1: a law of this project\'s extension (ext/manifest.json)']]);
  assert.match(String(told[0]?.nextStepVi), /ext\/docs\/ACME-SHAPE-1\.md/u);
  assert.throws(() => readWhy(undefined, ['ACME_NOBODY_DECLARED']), /has no entry for ACME_NOBODY_DECLARED/u);
});
