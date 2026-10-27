// proves: HFS_UNUSED_FILE@lite HFS_UNUSED_FILE@full
// The operation emitter is a real consumer of one declared API-app source entry, in both editions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { checkDeadExports } from '../runtime/scripts/hfs/architecture/dead-exports.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const ENTRY = 'apps/core/src/operations.ts';
const PLATFORM = 'src/modules/platform/operations';
const DIRECT = `import { defineOperations as register, query } from '../../../${PLATFORM}/operation.policy';
export const OPERATIONS = register({ 'health.read@1': query() });`;

function fixture(t, edition, { entry = DIRECT, kind = 'api', declared = true } = {}) {
  const root = mkdtemp(t, 'hfs-operation-contract-roots-');
  const contents = {
    'apps/core/src/main.ts': 'export {};',
    'apps/core/src/app.module.ts': 'export {};',
    'apps/core/src/extra.ts': 'export const unused = 1;',
    [ENTRY]: entry,
    [`${PLATFORM}/operation.policy.ts`]: 'export const defineOperations = <Table>(table: Table): Table => table; export const query = () => ({ kind: "query" as const });',
    [`${PLATFORM}/operations.contracts.ts`]: `import { defineOperations, query } from './operation.policy'; const entries = { 'health.read@1': query() }; export const TABLE = defineOperations(entries);`,
    [`${PLATFORM}/index.ts`]: "export { TABLE as OPERATIONS } from './operations.contracts';",
  };
  for (const [relative, text] of Object.entries(contents)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const options = { noLib: true, types: [], strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 };
  const program = ts.createProgram(Object.keys(contents).map(file => path.join(root, file)), options);
  const relativeOf = file => path.relative(root, file).split(path.sep).join('/');
  const app = { slot: kind === 'api' ? 'be.app.api' : 'be.app.worker', root: 'apps/core/src' };
  const platform = { slot: 'be.platform', root: PLATFORM };
  const ownerOf = file => file.startsWith('apps/core/src/') ? app : file.startsWith(`${PLATFORM}/`) ? platform : null;
  const files = new Map(Object.keys(contents).map(relative => {
    const owner = ownerOf(relative);
    return [relative, { sourceFile: program.getSourceFile(path.join(root, relative)), owner, slot: owner.slot, tier: owner === app ? 'app' : 'platform' }];
  }));
  const edges = [...files].flatMap(([from, node]) => node.sourceFile.statements.flatMap(declaration => {
    if ((!ts.isImportDeclaration(declaration) && !ts.isExportDeclaration(declaration)) || !declaration.moduleSpecifier) return [];
    const resolved = ts.resolveModuleName(declaration.moduleSpecifier.text, node.sourceFile.fileName, options, ts.sys).resolvedModule;
    const to = resolved && relativeOf(resolved.resolvedFileName);
    return files.has(to) ? [{ from, to, edge: { declaration }, reexport: ts.isExportDeclaration(declaration) }] : [];
  }));
  const graph = {
    files, edges, ownerRoots: new Map(), unit: () => null,
    abs: file => files.has(relativeOf(file)) ? relativeOf(file) : null,
    resolver: {
      repo: { profile: 'be', edition }, ownerOf,
      classifyPath: () => ({ slot: null }), ruleParams: () => ({}),
      slot: id => ({ tier: id.startsWith('be.app.') ? 'app' : 'platform', requires: ['main.ts', 'app.module.ts'] }),
    },
  };
  return checkDeadExports({ context: { ts, checkerFor: () => program.getTypeChecker() }, graph, config: { root, apps: declared ? [{ name: 'core', kind }] : [] } })
    .violations.filter(finding => finding.ruleId === 'HFS_UNUSED_FILE').map(finding => finding.path);
}

for (const edition of ['lite', 'full']) {
  test(`operation contract root ${edition}: the emitter consumes its declared API entry and follows aliases and reexports`, t => {
    const alias = DIRECT.replace('export const OPERATIONS = register(', 'const declare = register; export const OPERATIONS = declare(');
    for (const entry of [DIRECT, alias, `export { OPERATIONS } from '../../../${PLATFORM}';`]) {
      const findings = fixture(t, edition, { entry });
      assert.equal(findings.includes(ENTRY), false);
      assert.equal(findings.includes('apps/core/src/extra.ts'), true, 'other optional app files retain dead-file enforcement');
    }
  });

  test(`operation contract root ${edition}: arbitrary, empty and asserted registrations remain dead`, t => {
    const invalid = [
      'export const OPERATIONS = { "health.read@1": {} };',
      'const defineOperations = <T>(table: T): T => table; export const OPERATIONS = defineOperations({ "health.read@1": {} });',
      `import { defineOperations } from '../../../${PLATFORM}/operation.policy'; export const OPERATIONS = defineOperations({});`,
      `import { defineOperations } from '../../../${PLATFORM}/operation.policy'; export const OPERATIONS = defineOperations({} as { 'health.read@1': unknown });`,
      DIRECT.replace('export const OPERATIONS', 'export const UNRELATED'),
    ];
    for (const entry of invalid) assert.equal(fixture(t, edition, { entry }).includes(ENTRY), true);
  });

  test(`operation contract root ${edition}: an undeclared app or worker operation file is not an emitter entry`, t => {
    assert.equal(fixture(t, edition, { declared: false }).includes(ENTRY), true);
    assert.equal(fixture(t, edition, { kind: 'worker' }).includes(ENTRY), true);
  });
}
