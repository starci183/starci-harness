import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appDeclaration, archFixture, ts } from './helpers/hfs-arch-fixture.mjs';
import { loadArchitectureConfig } from '../runtime/scripts/hfs/architecture/config.mjs';
import { checkGrammar } from '../runtime/scripts/hfs/architecture/frontend-grammar.mjs';
import type { MakeViolation } from '../runtime/scripts/hfs/architecture/frontend-grammar.mjs';
import type { TypeContext } from '../runtime/scripts/hfs/architecture/type-context.mjs';
import { grammarContractFor } from '../runtime/scripts/lib/grammar-lint.mjs';
import type { GrammarComponentContract } from '../runtime/scripts/lib/grammar-lint.mjs';
import type { FileMap } from './helpers/hfs-arch-fixture.mjs';

const genericContract = {
  package: '@fixture/ui-grammar', entry: '@fixture/ui-grammar/renderers',
  styleEntry: '@fixture/ui-grammar/palette.css', peers: ['react', '@fixture/primitives'],
};
/** The generic contract as the resolver returns it: a family with no own entries admits the shared ones alone. */
const genericResolved: Readonly<GrammarComponentContract> = {
  ...genericContract, entries: [genericContract.entry], styleEntries: [genericContract.styleEntry], themeEntries: [],
};

function selectedCatalog(context: TestContext): void {
  const catalog = new URL('../runtime/knowledge/grammars/index.yaml', import.meta.url);
  const originalRead = fs.readFileSync;
  const content = JSON.stringify({ families: [
    { id: 'components', componentContract: genericContract },
    { id: 'alternate', contractRef: 'components' },
  ] });
  context.mock.method(fs, 'readFileSync', function readCatalog(this: unknown, file: unknown, ...options: unknown[]) {
    if (file instanceof URL && file.href === catalog.href) return content;
    return originalRead.apply(this, [file, ...options] as unknown as Parameters<typeof fs.readFileSync>);
  });
}

function fixture(context: TestContext, edition: string, grammar?: string, contract: Readonly<GrammarComponentContract> = genericResolved, files: FileMap = {}): string {
  const exported = (specifier: string): [string, string] => [`.${specifier.slice(contract.package.length)}`, `./dist${specifier.slice(contract.package.length)}`];
  const dependencies = Object.fromEntries([contract.package, ...contract.peers].map((name) => [name, '1.0.0']));
  const declared = appDeclaration('fe', {
    apps: [{ name: 'web', kind: 'next' }], ...(grammar === undefined ? {} : { grammar }),
  });
  const declaration = { ...declared, edition };
  return archFixture(context, { profile: 'fe', files: {
    '../hfs.json': JSON.stringify(declaration),
    '../package.json': JSON.stringify({ private: true, workspaces: ['fe/apps/*', 'fe/packages/*'] }),
    'apps/web/package.json': JSON.stringify({ name: '@fixture/web', dependencies }),
    'apps/web/src/app/globals.css': `@import "${contract.styleEntry}";\n`,
    'packages/ui/package.json': JSON.stringify({ name: '@fixture/ui', dependencies }),
    'packages/foreign/package.json': JSON.stringify({ name: '@fixture/foreign', dependencies: { '@fixture/unselected-grammar': '1.0.0' } }),
    [`../node_modules/${contract.package}/package.json`]: JSON.stringify({
      name: contract.package, exports: Object.fromEntries([...contract.entries, ...contract.styleEntries, ...contract.themeEntries].map(exported)),
      peerDependencies: Object.fromEntries(contract.peers.map(name => [name, '*'])),
    }),
    ...files,
  } });
}

function grammarSource(root: string, entry: string): TypeContext {
  const file = ts.createSourceFile(path.join(root, 'apps/web/src/app/page.tsx'), `import { Surface } from '${entry}';`, ts.ScriptTarget.Latest);
  // reason: the grammar check reads only these four members of the type context.
  return { ts, workspaces: [], files: [file], edges: new Map(), checkerFor: () => null } as unknown as TypeContext;
}

// reason: a source-free scan reads only workspaces and files of the type context.
const EMPTY_CONTEXT = { workspaces: [], files: [] } as unknown as TypeContext;

/** A globals.css importing each sheet, one `@import` a line. */
const css = (...sheets: string[]): string => sheets.map(sheet => `@import "${sheet}";\n`).join('');

const sourceFinding: MakeViolation = (_config, _file, _node, ruleId, message, details) => ({ ruleId, message, ...details });

for (const edition of ['lite'] as const) {
  test(`architecture resolves the explicit catalog family and its actual installed contract (${edition})`, context => {
    for (const family of ['core', 'offset-pop']) {
      const contract = grammarContractFor(family);
      const root = fixture(context, edition, family, contract);
      const config = loadArchitectureConfig(root);
      assert.deepEqual(config.frontend.grammar, {
        ...contract, styleSources: ['apps/web/src/app/globals.css'],
        consumerManifests: ['apps/web/package.json', 'packages/ui/package.json'],
      });
      assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding), []);
    }
  });

  test(`each family admits its own code, style and theme entries beside Common's, and refuses another family's (${edition})`, context => {
    const pop = grammarContractFor('offset-pop');
    assert.equal(pop.entry, '@starci/grammar/common', 'the shared entry every install must export');
    assert.equal(pop.styleEntry, '@starci/grammar/common.css');
    assert.deepEqual(pop.entries, ['@starci/grammar/common', '@starci/grammar/offset-pop']);
    assert.deepEqual(pop.styleEntries, ['@starci/grammar/common.css', '@starci/grammar/offset-pop/styles.css']);
    assert.deepEqual(pop.themeEntries, ['@starci/grammar/offset-pop/theme.css']);
    const core = grammarContractFor('core');
    assert.deepEqual(core.entries, ['@starci/grammar/common', '@starci/grammar/core']);
    assert.deepEqual(core.themeEntries, ['@starci/grammar/core/theme.css']);
    // An Offset Pop app as packages/grammar/README.md writes it: OffsetPopGrammarRoot from the family entry, its sheet and its optional palette.
    const root = fixture(context, edition, 'offset-pop', pop, {
      'apps/web/src/app/globals.css': css('@starci/grammar/offset-pop/styles.css', '@starci/grammar/offset-pop/theme.css'),
    });
    const config = loadArchitectureConfig(root);
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding), [], 'the family sheet and palette satisfy the style contract');
    const findings = (specifier: string): string[] => checkGrammar(config, grammarSource(root, specifier), sourceFinding).map(finding => finding.ruleId);
    assert.deepEqual(findings('@starci/grammar/offset-pop'), [], 'the family code entry');
    assert.deepEqual(findings('@starci/grammar/common'), [], 'the shared entry it re-exports stays admitted');
    assert.deepEqual(findings('@starci/grammar/core'), ['ARCH_GRAMMAR_EXPORT_BYPASS'], 'another family');
    const globals = path.join(root, 'apps/web/src/app/globals.css');
    fs.writeFileSync(globals, css('@starci/grammar/common.css'));
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding), [], 'the common sheet stays admitted');
    fs.writeFileSync(globals, css('@starci/grammar/offset-pop/theme.css'));
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding).map(finding => finding.ruleId), ['ARCH_GRAMMAR_CONTRACT_INVALID'], 'a theme never replaces a base sheet');
    fs.writeFileSync(globals, css('@starci/grammar/offset-pop/styles.css', '@starci/grammar/core/theme.css'));
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding).map(finding => finding.ruleId).sort(), ['ARCH_GRAMMAR_CONTRACT_INVALID', 'ARCH_GRAMMAR_EXPORT_BYPASS'], "another family's palette");
    // An install that does not export the family's own entries (an older Grammar) keeps the shared contract alone.
    const installed = path.join(path.dirname(root), 'node_modules', '@starci', 'grammar', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(installed, 'utf8'));
    for (const key of ['./offset-pop', './offset-pop/styles.css', './offset-pop/theme.css']) delete manifest.exports[key];
    fs.writeFileSync(installed, JSON.stringify(manifest));
    fs.writeFileSync(globals, css('@starci/grammar/common.css'));
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding), [], 'the shared contract alone is valid');
    assert.deepEqual(findings('@starci/grammar/offset-pop'), ['ARCH_GRAMMAR_EXPORT_BYPASS'], 'a family entry the install does not export');
    fs.writeFileSync(globals, css('@starci/grammar/offset-pop/styles.css'));
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding).map(finding => finding.ruleId).sort(), ['ARCH_GRAMMAR_CONTRACT_INVALID', 'ARCH_GRAMMAR_EXPORT_BYPASS'], 'a family sheet the install does not export');
  });

  test(`architecture uses a selected contract's package, entries and peers without family literals (${edition})`, context => {
    selectedCatalog(context);
    const root = fixture(context, edition, 'alternate');
    const config = loadArchitectureConfig(root);
    assert.deepEqual(config.frontend.grammar, {
      ...genericResolved, styleSources: ['apps/web/src/app/globals.css'],
      consumerManifests: ['apps/web/package.json', 'packages/ui/package.json'],
    });
    assert.deepEqual(checkGrammar(config, grammarSource(root, genericContract.entry), sourceFinding), []);
    const bypass = checkGrammar(config, grammarSource(root, `${genericContract.package}/internal`), sourceFinding);
    assert.deepEqual(bypass.map(finding => finding.ruleId), ['ARCH_GRAMMAR_EXPORT_BYPASS']);
    assert.equal(bypass[0]!.specifier, `${genericContract.package}/internal`);
    const installed = path.join(path.dirname(root), 'node_modules', genericContract.package, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(installed, 'utf8'));
    delete manifest.peerDependencies['@fixture/primitives'];
    fs.writeFileSync(installed, JSON.stringify(manifest));
    const findings = checkGrammar(config, EMPTY_CONTEXT, sourceFinding);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.ruleId, 'ARCH_GRAMMAR_CONTRACT_INVALID');
    assert.match(findings[0]!.message, /selected peers @fixture\/primitives, react/);
  });

  test(`architecture ignores optional peers and still refuses a required-peer mismatch (${edition})`, context => {
    selectedCatalog(context);
    const root = fixture(context, edition, 'alternate');
    const config = loadArchitectureConfig(root);
    const installed = path.join(path.dirname(root), 'node_modules', genericContract.package, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(installed, 'utf8'));
    manifest.peerDependencies = { ...manifest.peerDependencies, '@fixture/graph-lib': '^1.0.0', '@fixture/chart-lib': '^2.0.0' };
    manifest.peerDependenciesMeta = { '@fixture/graph-lib': { optional: true }, '@fixture/chart-lib': { optional: true } };
    fs.writeFileSync(installed, JSON.stringify(manifest));
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding), [], 'optional peers are no part of the contract');

    const required = { ...manifest, peerDependenciesMeta: { '@fixture/graph-lib': { optional: true } } };
    fs.writeFileSync(installed, JSON.stringify(required));
    const extra = checkGrammar(config, EMPTY_CONTEXT, sourceFinding);
    assert.deepEqual(extra.map(finding => finding.ruleId), ['ARCH_GRAMMAR_CONTRACT_INVALID'], 'a required peer beyond the selected ones is refused');
    assert.match(extra[0]!.message, /required peerDependencies .* selected peers @fixture\/primitives, react/);

    const optionalSelected = { ...manifest, peerDependenciesMeta: { ...manifest.peerDependenciesMeta, '@fixture/primitives': { optional: true } } };
    fs.writeFileSync(installed, JSON.stringify(optionalSelected));
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding).map(finding => finding.ruleId), ['ARCH_GRAMMAR_CONTRACT_INVALID'],
      'a selected peer made optional is a required-peer mismatch');
  });

  test(`architecture accepts an exported core-ext stylesheet beside the style entry and refuses other Grammar css (${edition})`, context => {
    selectedCatalog(context);
    const { package: name, styleEntry } = genericContract;
    const root = fixture(context, edition, 'alternate', genericResolved, {
      'apps/web/src/app/globals.css': `@import "${styleEntry}";\n@import "${name}/core/ext/graph.css";\n@import "${name}/core/ext/markdown.css";\n`,
    });
    const installed = path.join(path.dirname(root), 'node_modules', name, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(installed, 'utf8'));
    manifest.exports['./core/ext/graph.css'] = './dist/core/ext/graph/styles.css';
    manifest.exports['./core/ext/markdown.css'] = './dist/core/ext/markdown/styles.css';
    fs.writeFileSync(installed, JSON.stringify(manifest));
    const config = loadArchitectureConfig(root);
    assert.deepEqual(checkGrammar(config, EMPTY_CONTEXT, sourceFinding), [], 'declared core-ext stylesheets are accepted');

    const globals = path.join(root, 'apps/web/src/app/globals.css');
    const refused = (css: string): string[] => {
      fs.writeFileSync(globals, css);
      return checkGrammar(config, EMPTY_CONTEXT, sourceFinding).map(finding => finding.ruleId).sort();
    };
    assert.deepEqual(refused(`@import "${styleEntry}";\n@import "${name}/core/ext/pdf.css";\n`),
      ['ARCH_GRAMMAR_CONTRACT_INVALID', 'ARCH_GRAMMAR_EXPORT_BYPASS'], 'a core-ext stylesheet the install does not export is refused');
    assert.deepEqual(refused(`@import "${styleEntry}";\n@import "${name}/internal/theme.css";\n`),
      ['ARCH_GRAMMAR_CONTRACT_INVALID', 'ARCH_GRAMMAR_EXPORT_BYPASS'], 'any other Grammar css path is refused');
    assert.deepEqual(refused(`@import "${styleEntry}";\n@import "${name}/core/ext/graph/../../../internal.css";\n`),
      ['ARCH_GRAMMAR_CONTRACT_INVALID', 'ARCH_GRAMMAR_EXPORT_BYPASS'], 'a path escaping the ext folder is refused');
    assert.deepEqual(refused(`@import "${name}/core/ext/graph.css";\n`), ['ARCH_GRAMMAR_CONTRACT_INVALID'],
      'an ext stylesheet never replaces the selected style entry');
  });

  test(`architecture accepts an exported core-ext code entry in product source and refuses the rest (${edition})`, context => {
    selectedCatalog(context);
    const { package: name } = genericContract;
    const root = fixture(context, edition, 'alternate');
    const installed = path.join(path.dirname(root), 'node_modules', name, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(installed, 'utf8'));
    manifest.exports['./core/ext/graph'] = './dist/core/ext/graph/index.js';
    manifest.exports['./core/ext/graph.css'] = './dist/core/ext/graph/styles.css';
    manifest.exports['./core/ext/markdown/react'] = './dist/core/ext/markdown/react.js';
    manifest.exports['./core/ext/escape'] = '../outside.js';
    fs.writeFileSync(installed, JSON.stringify(manifest));
    const config = loadArchitectureConfig(root);
    const findings = (specifier: string): string[] => checkGrammar(config, grammarSource(root, specifier), sourceFinding).map(finding => finding.ruleId);
    assert.deepEqual(findings(`${name}/core/ext/graph`), [], 'an exported core-ext entry is accepted');
    assert.deepEqual(findings(`${name}/core/ext/markdown/react`), [], 'an exported core-ext sub-entry is accepted');
    for (const refused of [
      `${name}/core/ext/pdf`, // a core-ext entry the install does not export
      `${name}/core/ext/graph/internal`, // a deep path under an ext
      `${name}/core/ext/graph.css`, // a stylesheet belongs in globals.css, never in product source
      `${name}/core/ext/escape`, // an export whose target leaves the package
      `${name}/offset-pop`, // another family's entry
      `${name}/dist/core/ext/graph/index.js`, // an internal file
    ]) assert.deepEqual(findings(refused), ['ARCH_GRAMMAR_EXPORT_BYPASS'], refused);
  });

  test(`architecture refuses absent or unsupported selection when styles need a contract (${edition})`, context => {
    for (const family of [undefined, 'unlisted']) {
      const root = fixture(context, edition, family);
      assert.throws(() => loadArchitectureConfig(root), family === undefined ? /explicitly name/ : /no declared lint contract/);
    }
  });

  test(`architecture keeps the contract unavailable without a globals style source (${edition})`, context => {
    const root = fixture(context, edition, undefined, genericResolved, { 'apps/web/src/app/globals.css': null });
    assert.equal(loadArchitectureConfig(root).frontend.grammar, null);
  });
}
