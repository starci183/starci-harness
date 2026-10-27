import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appDeclaration, archFixture, ts } from './helpers/hfs-arch-fixture.mjs';
import { loadArchitectureConfig } from '../runtime/scripts/hfs/architecture/config.mjs';
import { checkGrammar } from '../runtime/scripts/hfs/architecture/frontend-grammar.mjs';
import { grammarContractFor } from '../runtime/scripts/lib/grammar-lint.mjs';

const genericContract = {
  package: '@fixture/ui-grammar', entry: '@fixture/ui-grammar/renderers',
  styleEntry: '@fixture/ui-grammar/palette.css', peers: ['react', '@fixture/primitives'],
};

function selectedCatalog(context) {
  const catalog = new URL('../runtime/knowledge/grammars/index.yaml', import.meta.url);
  const originalRead = fs.readFileSync;
  const content = JSON.stringify({ families: [
    { id: 'components', componentContract: genericContract },
    { id: 'alternate', contractRef: 'components' },
  ] });
  context.mock.method(fs, 'readFileSync', function readCatalog(file, ...options) {
    if (file instanceof URL && file.href === catalog.href) return content;
    return originalRead.call(this, file, ...options);
  });
}

function fixture(context, edition, grammar, contract = genericContract, files = {}) {
  const dependencies = Object.fromEntries([contract.package, ...contract.peers].map(name => [name, '1.0.0']));
  const declaration = appDeclaration('fe', {
    apps: [{ name: 'web', kind: 'next' }], ...(grammar === undefined ? {} : { grammar }),
  });
  declaration.edition = edition;
  return archFixture(context, { profile: 'fe', files: {
    '../hfs.json': JSON.stringify(declaration),
    '../package.json': JSON.stringify({ private: true, workspaces: ['fe/apps/*', 'fe/packages/*'] }),
    'apps/web/package.json': JSON.stringify({ name: '@fixture/web', dependencies }),
    'apps/web/src/app/globals.css': `@import "${contract.styleEntry}";\n`,
    'packages/ui/package.json': JSON.stringify({ name: '@fixture/ui', dependencies }),
    'packages/foreign/package.json': JSON.stringify({ name: '@fixture/foreign', dependencies: { '@fixture/unselected-grammar': '1.0.0' } }),
    [`../node_modules/${contract.package}/package.json`]: JSON.stringify({
      name: contract.package, exports: {
        [`.${contract.entry.slice(contract.package.length)}`]: './renderers.js',
        [`.${contract.styleEntry.slice(contract.package.length)}`]: './palette.css',
      },
      peerDependencies: Object.fromEntries(contract.peers.map(name => [name, '*'])),
    }),
    ...files,
  } });
}

function grammarSource(root, entry) {
  const file = ts.createSourceFile(path.join(root, 'apps/web/src/app/page.tsx'), `import { Surface } from '${entry}';`, ts.ScriptTarget.Latest);
  return { ts, workspaces: [], files: [file], edges: new Map(), checkerFor: () => null };
}

const sourceFinding = (config, file, node, ruleId, message, details) => ({ ruleId, message, ...details });

for (const edition of ['lite', 'full']) {
  test(`architecture resolves the explicit catalog family and its actual installed contract (${edition})`, context => {
    for (const family of ['core', 'offset-pop']) {
      const contract = grammarContractFor(family);
      const root = fixture(context, edition, family, contract);
      const config = loadArchitectureConfig(root);
      assert.deepEqual(config.frontend.grammar, {
        ...contract, styleSources: ['apps/web/src/app/globals.css'],
        consumerManifests: ['apps/web/package.json', 'packages/ui/package.json'],
      });
      assert.deepEqual(checkGrammar(config, { workspaces: [], files: [] }), []);
    }
  });

  test(`architecture uses a selected contract's package, entries and peers without family literals (${edition})`, context => {
    selectedCatalog(context);
    const root = fixture(context, edition, 'alternate');
    const config = loadArchitectureConfig(root);
    assert.deepEqual(config.frontend.grammar, {
      ...genericContract, styleSources: ['apps/web/src/app/globals.css'],
      consumerManifests: ['apps/web/package.json', 'packages/ui/package.json'],
    });
    assert.deepEqual(checkGrammar(config, grammarSource(root, genericContract.entry), sourceFinding), []);
    const bypass = checkGrammar(config, grammarSource(root, `${genericContract.package}/internal`), sourceFinding);
    assert.deepEqual(bypass.map(finding => finding.ruleId), ['ARCH_GRAMMAR_EXPORT_BYPASS']);
    assert.equal(bypass[0].specifier, `${genericContract.package}/internal`);
    const installed = path.join(path.dirname(root), 'node_modules', genericContract.package, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(installed, 'utf8'));
    delete manifest.peerDependencies['@fixture/primitives'];
    fs.writeFileSync(installed, JSON.stringify(manifest));
    const findings = checkGrammar(config, { workspaces: [], files: [] });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'ARCH_GRAMMAR_CONTRACT_INVALID');
    assert.match(findings[0].message, /selected peers @fixture\/primitives, react/);
  });

  test(`architecture refuses absent or unsupported selection when styles need a contract (${edition})`, context => {
    for (const family of [undefined, 'unlisted']) {
      const root = fixture(context, edition, family);
      assert.throws(() => loadArchitectureConfig(root), family === undefined ? /explicitly name/ : /no declared lint contract/);
    }
  });

  test(`architecture keeps the contract unavailable without a globals style source (${edition})`, context => {
    const root = fixture(context, edition, undefined, genericContract, { 'apps/web/src/app/globals.css': null });
    assert.equal(loadArchitectureConfig(root).frontend.grammar, null);
  });
}
