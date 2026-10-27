// proves: FE_STACK_UNLISTED@lite FE_STACK_UNLISTED@full
// proves: FE_STACK_CORE_MISSING@lite FE_STACK_CORE_MISSING@full
// proves: FE_STACK_FAMILY_LINT_MISSING@lite FE_STACK_FAMILY_LINT_MISSING@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { feStackAllowlistFindings } from '../runtime/scripts/hfs/rules/fe-stack.mjs';
import { byCodeUnit } from '../runtime/scripts/lib/list.mjs';

// FE_STACK_FORBIDDEN (rules/fe-stack.mjs): a front-end manifest never declares a package knowledge/hfs/fe-stack.yaml lists under a
// concern's `forbids` (owner ruling 2026-10-13, lite = full). The fe side judges every package.json it holds; the app root's one
// package.json carries both sides, so a library the back end owns (be infraOwners, e.g. graphql-ws, moment) is not a fe finding there.
const BE = { apps: [{ name: 'core', kind: 'api' }, { name: 'cli', kind: 'cli' }], connections: [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'database' }] };
const FE = { apps: [{ name: 'web', kind: 'next' }] };
const app = (edition) => ({ hfs: 3, kind: 'app', project: 'demo', ...(edition ? { edition } : {}), sides: { be: BE, fe: FE } });

const tree = (t, files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-fe-stack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(content));
  }
  return dir;
};
const stack = (repoRoot, files, edition) => checkRepo({ repoRoot, declaration: app(edition), files, tree: false }).findings.filter((f) => f.code === 'FE_STACK_FORBIDDEN');

test('FE_STACK_FORBIDDEN: the canonical libraries of every concern raise nothing, in the apps, the packages and the app root', (t) => {
  const files = {
    'package.json': { name: 'demo', dependencies: { graphql: '16.0.0', 'graphql-ws': '6.0.0', moment: '2.30.0' }, devDependencies: { typescript: '6.0.0' } },
    'fe/apps/web/package.json': { name: '@demo/web', dependencies: { next: '16.0.0', '@apollo/client': '4.0.0', swr: '2.3.0', axios: '1.12.0', 'react-hook-form': '7.60.0', zod: '4.0.0', '@reduxjs/toolkit': '2.8.0', zustand: '5.0.0', 'socket.io-client': '4.8.0', dayjs: '1.11.0', 'next-intl': '4.0.0' } },
    'fe/packages/demo-ui/package.json': { name: '@demo/ui', dependencies: { '@heroui/react': '3.0.0', '@heroicons/react': '2.2.0', '@starci/heroicons': '0.3.3', recharts: '3.0.0' } },
  };
  const repoRoot = tree(t, files);
  assert.deepEqual(stack(repoRoot, Object.keys(files)), []);
});

test('FE_STACK_FORBIDDEN: a forbidden alternative in an app or a package manifest, in any dependency section, is a finding naming the concern', (t) => {
  const files = {
    'package.json': { name: 'demo' },
    'fe/apps/web/package.json': { name: '@demo/web', dependencies: { urql: '4.0.0', '@tanstack/react-query': '5.0.0' }, devDependencies: { moment: '2.30.0' } },
    'fe/packages/demo-ui/package.json': { name: '@demo/ui', peerDependencies: { 'lucide-react': '0.400.0' }, optionalDependencies: { sonner: '2.0.0' } },
  };
  const repoRoot = tree(t, files);
  const found = stack(repoRoot, Object.keys(files));
  assert.deepEqual(found.map((f) => `${f.path}|${f.section}|${f.dependency}|${f.concern}`).sort(byCodeUnit), [
    'fe/apps/web/package.json|dependencies|@tanstack/react-query|data',
    'fe/apps/web/package.json|dependencies|urql|graphql',
    'fe/apps/web/package.json|devDependencies|moment|dates',
    'fe/packages/demo-ui/package.json|optionalDependencies|sonner|toast',
    'fe/packages/demo-ui/package.json|peerDependencies|lucide-react|icons',
  ]);
  assert.ok(found.every((f) => f.level === 'error' && /fe-stack\.yaml/.test(f.message)), JSON.stringify(found, null, 1));
  assert.match(found.find((f) => f.dependency === 'urql').message, /@apollo\/client/, 'the finding names the canonical package');
});

test('FE_STACK_FORBIDDEN: the app root manifest is judged too, except a library the back end owns', (t) => {
  const files = { 'package.json': { name: 'demo', dependencies: { 'graphql-ws': '6.0.0', moment: '2.30.0', formik: '2.4.0' }, devDependencies: { 'react-toastify': '11.0.0' } } };
  const repoRoot = tree(t, files);
  assert.deepEqual(stack(repoRoot, Object.keys(files)).map((f) => f.dependency).sort(byCodeUnit), ['formik', 'react-toastify']);
});

test('FE_STACK_FORBIDDEN judges a lite app exactly as a full one, and a back-end manifest never', (t) => {
  const files = {
    'package.json': { name: 'demo' },
    'fe/apps/web/package.json': { name: '@demo/web', dependencies: { 'graphql-ws': '6.0.0', 'pusher-js': '8.0.0' } },
    'be/apps/core/package.json': { name: '@demo/core', dependencies: { 'graphql-ws': '6.0.0', moment: '2.30.0' } },
  };
  const repoRoot = tree(t, files);
  for (const edition of [undefined, 'lite']) {
    assert.deepEqual(stack(repoRoot, Object.keys(files), edition).map((f) => f.path), ['fe/apps/web/package.json'], `edition ${edition ?? 'full'}`);
  }
});

const catalog = parseYaml(fs.readFileSync(new URL('../runtime/knowledge/hfs/fe-stack.yaml', import.meta.url), 'utf8'));
const core = [...new Set(catalog.concerns.filter(concern => concern.tier === 'core').flatMap(concern => concern.packages))];
const dependencies = names => Object.fromEntries(names.map(name => [name, '1.0.0']));
const product = (extra = {}) => ({ name: '@demo/web', dependencies: dependencies(core), ...extra });
const allowlist = (repoRoot, files, edition, extra = {}) => feStackAllowlistFindings({
  repoRoot: path.join(repoRoot, 'fe'), files: Object.keys(files).filter(file => file.startsWith('fe/')).map(file => file.slice(3)),
  repo: { profile: 'fe', kind: 'app', edition, ...FE, ...extra },
});

for (const edition of ['lite', 'full']) {
  test(`Grammar owns DiceBear dependencies, with Avatar seed guidance in every manifest section (${edition})`, t => {
    const sections = {
      dependencies: { '@dicebear/core': '1.0.0' }, devDependencies: { '@dicebear/styles': '1.0.0' },
      peerDependencies: { '@dicebear/micah': '1.0.0' }, optionalDependencies: { '@dicebear/collection': '1.0.0' },
    };
    const files = {
      'package.json': { name: 'demo', ...sections },
      'fe/apps/web/package.json': product({ ...sections, dependencies: { ...dependencies(core), ...sections.dependencies } }),
      'fe/packages/ui/package.json': { name: '@demo/ui', ...sections },
    };
    const root = tree(t, files);
    const findings = stack(root, Object.keys(files), edition);
    assert.equal(findings.length, 12);
    assert.ok(findings.every(finding => finding.concern === 'avatar-illustration' && /Avatar.*seed|seed.*Avatar/.test(finding.message)));
    assert.deepEqual(allowlist(root, files, edition), []);
  });

  test(`Grammar's installed runtime dependencies are not app dependencies (${edition})`, t => {
    const files = {
      'fe/apps/web/package.json': product(),
      'fe/apps/web/node_modules/@starci/grammar/package.json': { name: '@starci/grammar', dependencies: { '@dicebear/core': '1.0.0', '@dicebear/styles': '1.0.0' } },
      'fe/apps/web/node_modules/@starci/grammar/node_modules/@dicebear/core/package.json': { name: '@dicebear/core', dependencies: { 'generator-support': '1.0.0' } },
      'fe/node_modules/@dicebear/styles/package.json': { name: '@dicebear/styles', dependencies: { '@dicebear/micah': '1.0.0' } },
    };
    const root = tree(t, files);
    assert.deepEqual(allowlist(root, files, edition), []);
    assert.deepEqual(stack(root, Object.keys(files), edition), []);
  });

  test(`The DiceBear scope boundary does not suppress unknown packages or admit direct dependencies through extras (${edition})`, t => {
    const files = {
      'hfs.json': app(edition),
      'fe/apps/web/package.json': product({ dependencies: { ...dependencies(core), '@dicebear/core': '1.0.0', '@dicebearish/core': '1.0.0' } }),
    };
    files['hfs.json'].sides.fe = { ...FE, extraPackages: [{ name: '@dicebear/core', reason: 'Avatar generator' }] };
    const root = tree(t, files);
    assert.deepEqual(allowlist(root, files, edition).map(finding => finding.dependency), ['@dicebearish/core']);
    assert.deepEqual(stack(root, Object.keys(files), edition).map(finding => finding.dependency), ['@dicebear/core']);
  });

  test(`FE_STACK_UNLISTED rejects an uncatalogued dependency in every section (${edition})`, t => {
    const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    const files = { 'fe/apps/web/package.json': product(Object.fromEntries(sections.map((section, index) => [section, { ...dependencies(section === 'dependencies' ? core : []), [`unknown-${index}`]: '1.0.0' }]))) };
    const root = tree(t, files);
    const findings = allowlist(root, files, edition).filter(finding => finding.code === 'FE_STACK_UNLISTED');
    assert.deepEqual(findings.map(finding => finding.section), sections);
    assert.ok(findings.every(finding => finding.level === 'error' && /fe.extraPackages/.test(finding.message)));
  });

  test(`FE_STACK_UNLISTED accepts canonical libraries, local workspaces and reasoned extras (${edition})`, t => {
    const files = {
      'fe/apps/web/package.json': product({ dependencies: { ...dependencies(core), '@demo/ui': '*', 'domain-reader': '1.0.0' } }),
      'fe/packages/ui/package.json': { name: '@demo/ui', peerDependencies: { react: '1.0.0' } },
    };
    const root = tree(t, files);
    assert.deepEqual(allowlist(root, files, edition, { fe: { extraPackages: [{ name: 'domain-reader', reason: 'Read the product file format' }] } }), []);
    for (const reason of ['', '  ', undefined]) {
      assert.equal(allowlist(root, files, edition, { fe: { extraPackages: [{ name: 'domain-reader', reason }] } }).filter(finding => finding.code === 'FE_STACK_UNLISTED').length, 1);
    }
  });

  test(`FE_STACK_UNLISTED reads reasoned extras from the declared fe side (${edition})`, t => {
    const name = '@fontsource-variable/inter';
    const declaration = app(edition);
    declaration.sides.fe = { ...FE, extraPackages: [
      { name, reason: 'Self-host the product brand font' }, { name: 'urql', reason: 'Another GraphQL client' },
    ] };
    const files = {
      'hfs.json': declaration,
      'fe/apps/web/package.json': product({ dependencies: { ...dependencies(core), [name]: '1.0.0', 'undeclared-reader': '1.0.0', urql: '1.0.0' } }),
    };
    const root = tree(t, files);
    const findings = checkRepo({ repoRoot: root, declaration, files: Object.keys(files), tree: false }).findings;
    assert.ok(!findings.some(finding => finding.code === 'HFS_DECLARATION_INVALID'));
    assert.deepEqual(findings.filter(finding => finding.code === 'FE_STACK_UNLISTED').map(finding => finding.dependency), ['undeclared-reader']);
    assert.deepEqual(findings.filter(finding => finding.code === 'FE_STACK_FORBIDDEN').map(finding => finding.dependency), ['urql']);
  });

  test(`FE_STACK_UNLISTED uses the resolved side when hfs.json is supplied in memory (${edition})`, t => {
    const declaration = app(edition);
    declaration.sides.fe = { ...FE, extraPackages: [{ name: 'product-reader', reason: 'Read the product data format' }] };
    const files = { 'fe/apps/web/package.json': product({ dependencies: { ...dependencies(core), 'product-reader': '1.0.0' } }) };
    const root = tree(t, files);
    const findings = checkRepo({ repoRoot: root, declaration, files: Object.keys(files), tree: false }).findings;
    assert.deepEqual(findings.filter(finding => ['HFS_DECLARATION_INVALID', 'FE_STACK_UNLISTED'].includes(finding.code)), []);
  });

  test(`FE_STACK_CORE_MISSING rejects missing core packages in product apps (${edition})`, t => {
    const missing = ['axios', 'dayjs', 'next-themes', 'superjson', 'zustand'];
    const files = { 'fe/apps/web/package.json': product({ dependencies: dependencies(core.filter(name => !missing.includes(name))) }) };
    const root = tree(t, files);
    const findings = allowlist(root, files, edition);
    assert.deepEqual(findings.map(finding => finding.dependency).sort(byCodeUnit), missing);
    assert.ok(findings.every(finding => finding.code === 'FE_STACK_CORE_MISSING' && finding.path === 'apps/web/package.json'));
  });

  test(`FE_STACK_CORE_MISSING accepts the full core and root-installed tools (${edition})`, t => {
    const rootNames = new Set(catalog.concerns.filter(concern => ['codegen', 'lint'].includes(concern.id)).flatMap(concern => concern.packages).concat(['typescript', 'tailwindcss']));
    const files = {
      'package.json': { devDependencies: dependencies([...rootNames]), dependencies: { 'backend-only-sdk': '1.0.0' } },
      'fe/apps/web/package.json': product({ dependencies: dependencies(core.filter(name => !rootNames.has(name))) }),
    };
    const root = tree(t, files);
    assert.deepEqual(allowlist(root, files, edition), []);
  });
}

// From canon-fe 9 the Grammar component rules ship in the selected family's lint package (FE-RULE-OWNERSHIP).
const FAMILY_LINT = { core: ['@starci/eslint-grammar-core', 'coreGrammarConfig'], 'offset-pop': ['@starci/eslint-grammar-offset-pop', 'offsetPopGrammarConfig'] };
const rootLintTools = () => dependencies(catalog.concerns.filter(concern => ['codegen', 'lint'].includes(concern.id)).flatMap(concern => concern.packages).concat(['typescript', 'tailwindcss']));
const familyApp = (t, edition, grammar, rootExtra) => {
  const declaration = app(edition);
  declaration.sides.fe = { ...FE, grammar };
  const devDependencies = { ...rootLintTools(), ...rootExtra };
  const files = {
    'hfs.json': declaration,
    'package.json': { name: 'demo', devDependencies },
    'fe/apps/web/package.json': product({ dependencies: dependencies(core.filter(name => !Object.hasOwn(devDependencies, name))) }),
  };
  return { declaration, files, root: tree(t, files) };
};
const familyFindings = (findings) => findings.filter(finding => finding.code === 'FE_STACK_FAMILY_LINT_MISSING');

for (const edition of ['lite', 'full']) for (const [grammar, [family, factory]] of Object.entries(FAMILY_LINT)) {
  test(`FE_STACK_FAMILY_LINT_MISSING accepts a ${grammar} app that installs canon-fe 9 with ${family} (${edition})`, t => {
    const { files, root } = familyApp(t, edition, grammar, { '@starci/eslint-canon-fe': '9.0.0', [family]: '0.12.0' });
    assert.deepEqual(allowlist(root, files, edition, { grammar }), []);
  });

  test(`FE_STACK_FAMILY_LINT_MISSING refuses a ${grammar} app that installs canon-fe 9 without ${family} (${edition})`, t => {
    const { files, root } = familyApp(t, edition, grammar, { '@starci/eslint-canon-fe': '9.0.0' });
    const findings = allowlist(root, files, edition, { grammar });
    assert.deepEqual(findings.map(finding => finding.code), ['FE_STACK_FAMILY_LINT_MISSING']);
    const [finding] = findings;
    assert.equal(finding.level, 'error');
    assert.equal(finding.path, 'apps/web/package.json');
    assert.equal(finding.dependency, family);
    assert.equal(finding.family, grammar);
    assert.ok(finding.nextStep.includes(family) && finding.nextStep.includes(factory), finding.nextStep);
    assert.ok(finding.message.includes(family) && finding.message.includes(`sides.fe.grammar ${grammar}`), finding.message);
  });
}

test('FE_STACK_FAMILY_LINT_MISSING reads the family package from any front-end manifest and the selection from hfs.json', t => {
  const { files, root } = familyApp(t, 'full', 'core', { '@starci/eslint-canon-fe': '^9.1.0' });
  assert.equal(familyFindings(allowlist(root, files, 'full')).length, 1, 'the declared hfs.json selection applies without a resolved view');
  const workspace = { ...files, 'fe/apps/web/package.json': { ...files['fe/apps/web/package.json'], devDependencies: { '@starci/eslint-grammar-core': '0.12.0' } } };
  const installed = tree(t, workspace);
  assert.deepEqual(familyFindings(allowlist(installed, workspace, 'full')), []);
});

test('FE_STACK_FAMILY_LINT_MISSING leaves canon-fe 8, which still carries the Grammar rules, and judges an unversioned spec like 9', t => {
  const legacy = familyApp(t, 'lite', 'core', { '@starci/eslint-canon-fe': '8.4.43' });
  assert.deepEqual(familyFindings(allowlist(legacy.root, legacy.files, 'lite', { grammar: 'core' })), []);
  const unversioned = familyApp(t, 'lite', 'core', { '@starci/eslint-canon-fe': 'file:../canon-fe.tgz' });
  assert.equal(familyFindings(allowlist(unversioned.root, unversioned.files, 'lite', { grammar: 'core' })).length, 1);
});

test('FE_STACK_FAMILY_LINT_MISSING is reported by the app check', t => {
  const { declaration, files, root } = familyApp(t, 'full', 'core', { '@starci/eslint-canon-fe': '9.0.0' });
  const findings = familyFindings(checkRepo({ repoRoot: root, declaration, files: Object.keys(files), tree: false }).findings);
  assert.deepEqual(findings.map(finding => [finding.path, finding.dependency]), [['fe/apps/web/package.json', '@starci/eslint-grammar-core']]);
});

test('FE_STACK_CORE_MISSING exempts the marketing landing in lite and full, and nothing else', t => {
  const files = { 'fe/apps/landing/package.json': { name: '@demo/landing', dependencies: { next: '1.0.0' } } };
  const root = tree(t, files);
  const apps = [{ name: 'landing', kind: 'next' }];
  assert.deepEqual(allowlist(root, files, 'full', { apps }), []);
  assert.deepEqual(allowlist(root, files, 'lite', { apps }), []);
  const other = { 'fe/apps/shop/package.json': { name: '@demo/shop', dependencies: { next: '1.0.0' } } };
  assert.ok(allowlist(tree(t, other), other, 'lite', { apps: [{ name: 'shop', kind: 'next' }] }).some(finding => finding.code === 'FE_STACK_CORE_MISSING'));
});

test('FE_STACK_UNLISTED uses hfs.json reasoned declarations and keeps forbidden alternatives refused', t => {
  const files = {
    'hfs.json': { fe: { extraPackages: [{ name: 'custom-reader', reason: 'Product format' }, { name: 'urql', reason: 'Another client' }] } },
    'fe/apps/web/package.json': product({ dependencies: { ...dependencies(core), 'custom-reader': '1.0.0', urql: '1.0.0' } }),
  };
  const root = tree(t, files);
  assert.deepEqual(allowlist(root, files, 'lite'), []);
  assert.equal(stack(root, Object.keys(files), 'lite').filter(finding => finding.dependency === 'urql').length, 1);
});

test('FE_STACK_CORE_MISSING cannot be satisfied by a sibling product workspace', t => {
  const files = { 'fe/apps/web/package.json': product(), 'fe/apps/other/package.json': { name: '@demo/other', dependencies: {} } };
  const root = tree(t, files);
  const findings = allowlist(root, files, 'full', { apps: [...FE.apps, { name: 'other', kind: 'next' }] });
  assert.equal(findings.filter(finding => finding.path === 'apps/other/package.json').length, core.length);
});

test('FE_STACK_CORE_MISSING rechecks shared root tools when a scoped check selects no FE manifest', t => {
  const files = { 'package.json': {}, 'fe/apps/web/package.json': product({ dependencies: dependencies(core.filter(name => name !== 'typescript')) }) };
  const root = tree(t, files);
  const findings = feStackAllowlistFindings({ repoRoot: path.join(root, 'fe'), files: ['apps/web/package.json'],
    repo: { profile: 'fe', kind: 'app', edition: 'lite', ...FE }, inScope: () => false });
  assert.deepEqual(findings.map(finding => [finding.code, finding.dependency]), [['FE_STACK_CORE_MISSING', 'typescript']]);
});
