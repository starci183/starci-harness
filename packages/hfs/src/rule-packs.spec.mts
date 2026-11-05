// proves: HFS_RULE_PACK_INVALID@lite
// proves: HFS_RULE_PACK_INVALID@full
// Rule packs (PROJECT-LINT-3, R381): an app adds its own laws through packages hfs.json `rulePacks` names. The app check runs a pack's machine rules
// under the pack's codes, the canon factories load its ESLint rules, and a pack that tries to do anything but add a rule lends nothing.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadRulePacks, packEslintConfigs, rulePackFindings, RULE_PACK_INVALID } from '../runtime/scripts/lib/rule-packs.mjs';
import { rulePackCheckFindings, reservedCodes } from '../runtime/scripts/hfs/rules/app-extension-findings.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const PACK = '@acme/hfs-rules';
const SOUND_RULES = `[
  { id: 'ACME-BLOCK-1', code: 'ACME_BLOCK_INCOMPLETE', severity: 'error', spec: 'spec/block.spec.mjs', doc: 'docs/ACME-BLOCK-1.md',
    check: (context) => context.files.filter((file) => file.startsWith('packages/blocks/src/') && file.endsWith('.ts') && !(context.read(file) ?? '').includes('schema'))
      .map((file) => ({ path: file, line: 1, message: file + ' has no schema' })) },
  { id: 'ACME-BLOCK-3', code: 'ACME_BLOCK_ESCAPE_PROP', severity: 'warning', spec: 'spec/escape.spec.mjs', doc: 'https://example.invalid/acme-block-3',
    eslint: { name: 'no-children-prop', sides: ['fe', 'packages'], rule: { meta: { type: 'problem' }, create: () => ({}) } } },
]`;

/** An app at a temp root whose node_modules holds the pack `name` with the rules source `rules` (a JS array literal) and any `extra` manifest keys. */
function app(t: TestContext, { rules = SOUND_RULES, name = PACK, extra = '', declared = [PACK] }: { rules?: string; name?: string; extra?: string; declared?: unknown } = {}): string {
  const root = mkdtemp(t, 'starci-rule-pack-');
  const write = (file: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('package.json', '{"private":true}\n');
  write('hfs.json', JSON.stringify({ hfs: 3, kind: 'app', project: 'acme', rulePacks: declared, sides: { be: { apps: [] }, fe: { apps: [] } } }));
  const dir = `node_modules/${PACK}`;
  write(`${dir}/package.json`, JSON.stringify({ name: PACK, version: '1.0.0', type: 'module', exports: { './rule-pack': './rule-pack.mjs', './package.json': './package.json' } }));
  write(`${dir}/rule-pack.mjs`, `export default { schema: 'starci/rule-pack@1', name: ${JSON.stringify(name)}, rules: ${rules}${extra} };\n`);
  write(`${dir}/spec/block.spec.mjs`, '// the spec of ACME-BLOCK-1\n');
  write(`${dir}/spec/escape.spec.mjs`, '// the spec of ACME-BLOCK-3\n');
  write(`${dir}/docs/ACME-BLOCK-1.md`, '# ACME-BLOCK-1\n');
  write('packages/blocks/src/card.ts', 'export const card = 1;\n');
  write('packages/blocks/src/list.ts', 'export const schema = 1;\n');
  return root;
}

const files = ['hfs.json', 'packages/blocks/src/card.ts', 'packages/blocks/src/list.ts'];
const read = (root: string) => (file: string): string | null => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
const problems = (root: string): string[] => loadRulePacks(root, reservedCodes()).problems.map((problem) => problem.message);

test('a sound pack lends its rules: the machine rule judges the tracked files under its own code and severity, with its id and doc', (t) => {
  const root = app(t);
  const packs = loadRulePacks(root, reservedCodes());
  assert.deepEqual(packs.problems, []);
  assert.deepEqual(packs.rules.map((rule) => [rule.id, rule.code, rule.severity, rule.check !== undefined, rule.eslint?.name ?? null]), [
    ['ACME-BLOCK-1', 'ACME_BLOCK_INCOMPLETE', 'error', true, null],
    ['ACME-BLOCK-3', 'ACME_BLOCK_ESCAPE_PROP', 'warning', false, 'no-children-prop'],
  ]);
  assert.deepEqual(rulePackFindings({ repoRoot: root, files, reserved: reservedCodes(), read: read(root) }), [
    { code: 'ACME_BLOCK_INCOMPLETE', level: 'error', path: 'packages/blocks/src/card.ts', line: 1, message: 'packages/blocks/src/card.ts has no schema (ACME-BLOCK-1, docs/ACME-BLOCK-1.md)' },
  ]);
  for (const edition of ['lite', 'full']) {
    const found = rulePackCheckFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition }, isRoot: true });
    assert.deepEqual(found.map((finding) => [finding.code, finding.path, finding.level]), [['ACME_BLOCK_INCOMPLETE', 'packages/blocks/src/card.ts', 'error']]);
    assert.deepEqual(rulePackCheckFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition }, isRoot: false }), []);
  }
});

test('the canon factories load the ESLint rules of a pack for the sides it names, one plugin per pack, at the pack\'s severity', (t) => {
  const root = app(t);
  fs.mkdirSync(path.join(root, 'fe'), { recursive: true });
  assert.deepEqual(packEslintConfigs(path.join(root, 'be'), 'be'), [], 'the rule names no be side');
  const [fe] = packEslintConfigs(path.join(root, 'fe'), 'fe');
  assert.deepEqual(fe?.rules, { [`${PACK}/no-children-prop`]: 'warn' });
  assert.equal(typeof fe?.plugins[PACK]?.rules['no-children-prop']?.create, 'function');
  const [packages] = packEslintConfigs(root, 'packages', ['packages/*/src/**/*.ts']);
  assert.deepEqual(packages?.files, ['packages/*/src/**/*.ts']);
  assert.equal(packages?.plugins[PACK], fe?.plugins[PACK], 'the same plugin object, so one config may name a pack twice');
  const none = mkdtemp(t, 'starci-rule-pack-none-');
  fs.writeFileSync(path.join(none, 'hfs.json'), JSON.stringify({ kind: 'app' }));
  assert.deepEqual(packEslintConfigs(none, 'fe'), [], 'an app without packs loads nothing');
});

test(`${RULE_PACK_INVALID}: a pack only adds; a rule that turns off, overrides or reuses a code, or lacks its spec, doc or engine, refuses the whole pack`, (t) => {
  const rule = (fields: string): string => `[{ id: 'ACME-X-1', code: 'ACME_X', severity: 'error', spec: 'spec/block.spec.mjs', doc: 'docs/ACME-BLOCK-1.md', ${fields} }]`;
  const check = 'check: () => []';
  const cases: [string, Parameters<typeof app>[1], RegExp][] = [
    ['off key', { rules: rule(`${check}, off: ['R25']`) }, /has off: a pack only adds rules, it never turns one off, overrides or lowers it/u],
    ['harness code', { rules: rule(check).replace("code: 'ACME_X'", "code: 'HFS_UNUSED_EXPORT'") }, /HFS_UNUSED_EXPORT is a code the harness reports/u],
    ['no spec', { rules: rule(check).replace('spec/block.spec.mjs', 'spec/missing.spec.mjs') }, /spec must name the file of the package that proves the rule/u],
    ['no doc', { rules: rule(check).replace("doc: 'docs/ACME-BLOCK-1.md'", "doc: 'http://plain.invalid'") }, /doc must be a file of the package or an https link/u],
    ['two engines', { rules: rule(`${check}, eslint: { name: 'x', sides: ['fe'], rule: { create: () => ({}) } }`) }, /a rule has exactly one engine/u],
    ['bad severity', { rules: rule(check).replace("severity: 'error'", "severity: 'off'") }, /severity must be error or warning/u],
    ['bad id', { rules: rule(check).replace("'ACME-X-1'", "'acme1'") }, /id must be an upper-case law id/u],
    ['bad side', { rules: rule("eslint: { name: 'x', sides: ['docs'], rule: { create: () => ({}) } }") }, /eslint\.sides must name some of be, fe, packages/u],
    ['manifest key', { extra: ", disable: ['R25']" }, /its manifest has disable: a pack holds only schema, name and the rules it adds/u],
    ['other name', { name: '@acme/other' }, /its manifest names @acme\/other, not the package/u],
    ['not installed', { declared: [PACK, '@acme/absent'] }, /cannot be loaded from the app's install/u],
  ];
  for (const [label, options, expected] of cases) {
    const root = app(t, options);
    assert.ok(problems(root).some((message) => expected.test(message)), `${label}: ${problems(root).join(' | ')}`);
    const findings = rulePackFindings({ repoRoot: root, files, reserved: reservedCodes(), read: read(root) });
    assert.ok(findings.some((finding) => finding.code === RULE_PACK_INVALID && finding.path === 'hfs.json'), label);
    if (label !== 'not installed') assert.ok(!findings.some((finding) => finding.code === 'ACME_BLOCK_INCOMPLETE' || finding.code === 'ACME_X'), `${label}: a refused pack lends no rule`);
    if (label !== 'not installed') assert.throws(() => packEslintConfigs(root, 'fe'), /^Error: HFS_RULE_PACK_INVALID: /u, `${label}: a lint run never guesses`);
  }
  const twice = app(t, { rules: `${SOUND_RULES.slice(0, -1)}, { id: 'ACME-BLOCK-1', code: 'ACME_OTHER', severity: 'error', spec: 'spec/block.spec.mjs', doc: 'docs/ACME-BLOCK-1.md', check: () => [] }]` });
  assert.ok(problems(twice).some((message) => /ACME-BLOCK-1: the id is also a rule of @acme\/hfs-rules/u.test(message)));
  const throws = app(t, { rules: rule("check: () => { throw new Error('boom') }") });
  assert.deepEqual(rulePackFindings({ repoRoot: throws, files, reserved: reservedCodes(), read: read(throws) }).map((finding) => finding.message), ['hfs.json rulePacks: @acme/hfs-rules ACME-X-1 threw (boom); a rule that cannot judge is no rule (R381)']);
  const pathless = app(t, { rules: rule("check: () => [{ message: 'no path' }]") });
  assert.match(rulePackFindings({ repoRoot: pathless, files, reserved: reservedCodes(), read: read(pathless) })[0]?.message ?? '', /returned a finding without a path and a message/u);
});

test('hfs.json rulePacks is a non-empty list of package names, each once', () => {
  const declared = (rulePacks: unknown): string[] => declarationShapeProblems({ hfs: 3, kind: 'app', project: 'acme', rulePacks, sides: { be: { apps: [] }, fe: { apps: [] } } }, ['be', 'fe']).filter((problem) => problem.startsWith('rulePacks'));
  assert.deepEqual(declared([PACK, 'plain-pack']), []);
  for (const bad of [[], 'x', [PACK, PACK], ['Not A Name'], [1]]) assert.equal(declared(bad).length, 1, JSON.stringify(bad));
});
