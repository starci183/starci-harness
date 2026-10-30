import test from 'node:test';
import type { CompilerOptions, Identifier, ImportDeclaration, ModuleResolutionHost, NamedImports, Program, SourceFile } from 'typescript';
import assert from 'node:assert/strict';
import path from 'node:path';
import { archFixture, ts, writeFiles } from './helpers/hfs-arch-fixture.mjs';
import { loadArchitectureConfig } from '../runtime/scripts/hfs/architecture/config.mjs';
import { buildTypeScriptContext, relativePath } from '../runtime/scripts/hfs/architecture/typescript.mjs';
import { checkBackend } from '../runtime/scripts/hfs/architecture/backend.mjs';
import { createTypeScriptProgram, withTypeScriptProgramRun } from '../runtime/scripts/hfs/typescript-programs.mjs';
import { contextFromProjects } from '../runtime/scripts/hfs/architecture/type-context.mjs';
import type { TypeContext, TypeContextHelpers } from '../runtime/scripts/hfs/architecture/type-context.mjs';
import type { ArchitectureConfig } from '../runtime/scripts/hfs/architecture/config.mjs';

// reason: the context builder reads only `ts` of the loaded TypeScript and a few members of the config and helpers; the last test builds those by hand.
// The helpers double likewise carries only the members the build reads.
type LoadedTypeScript = Parameters<typeof contextFromProjects>[1];

const LIB = 'src/modules/platform/library';
const APPLICATION = 'src/features/api/orders/application/read.service.ts';
const TRANSPORT = 'src/features/api/orders/transport/rest/order.dto.ts';

const compilerOptions = {
  target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noLib: true,
  baseUrl: '.', paths: { '@library/*': [`${LIB}/*`], '@local': [`${LIB}/root-local.ts`] },
};

const fixtureFiles = {
  'tsconfig.json': JSON.stringify({ compilerOptions, include: ['src/**/*', 'apps/**/*'] }),
  'apps/core/tsconfig.json': JSON.stringify({
    extends: '../../tsconfig.json', compilerOptions: { baseUrl: '.', paths: { '@local': ['./src/compose/local.ts'] } }, include: ['src/**/*'],
  }),
  'apps/core/src/main.ts': "import { local } from '@local';\nexport const started = local();\n",
  'apps/core/src/compose/local.ts': "export function local(): 'nested' { return 'nested'; }\n",
  [`${LIB}/root-local.ts`]: "export function local(): 'root' { return 'root'; }\n",
  [`${LIB}/value.ts`]: 'export interface Payload { readonly code: string }\nexport function measure(value: string): number { return value.length; }\n',
  [`${LIB}/barrel.ts`]: "export { measure as count } from './value';\nexport type { Payload } from './value';\n",
  [`${LIB}/cycle-a.ts`]: "export * from './cycle-b';\nexport { count } from './barrel';\n",
  [`${LIB}/cycle-b.ts`]: "export * from './cycle-a';\nexport type { OrderDto } from '../../../features/api/orders/transport/rest/order.dto';\nexport { Controller as endpoint } from '@nestjs/common';\n",
  [TRANSPORT]: 'export interface OrderDto { readonly code: string }\n',
  [APPLICATION]: "import { count as size, endpoint } from '@library/cycle-a';\nimport type { Payload } from '@library/barrel';\nexport const result = size('order');\nexport type Input = Payload;\n",
  [`${LIB}/references.ts`]: [
    "import type { Payload } from './value';",
    "export type Imported = import('./value').Payload;",
    "import legacy = require('./value');",
    "void import('./value');",
    "void require('./value');",
    "function shadowed(require: (name: string) => unknown) { return require('./not-a-dependency'); }",
    "void import('./missing');",
    "import './style.css';",
    "import './__generated__/wire';",
    'declare const target: string;',
    'void import(target);',
    'void require(target);',
    "import { other } from '../../../../../fe/source';",
    'export const refs = [legacy, shadowed, other];',
  ].join('\n'),
  '../fe/source.ts': 'export const other = 1;\n',
};

const relativeEdges = (config: { root: string }, context: Pick<TypeContext, 'edges'>) => [...context.edges.values()].flat().map(edge => [
  relativePath(config.root, edge.from), relativePath(config.root, edge.to),
  edge.specifier, edge.runtime, edge.reexport, edge.project, edge.line, edge.column,
]).sort((a, b) => `${a[0]}:${a[6]}:${a[7]}`.localeCompare(`${b[0]}:${b[6]}:${b[7]}`));

/** The identifier of the first named import of a source file whose first statement is `import { name } from '...'`. */
const firstImportName = (source: SourceFile): Identifier => {
  const statement = source.statements[0] as ImportDeclaration;
  return (statement.importClause!.namedBindings as NamedImports).elements[0]!.name;
};

const localOrigin = (root: string, program: Program): string => {
  const source = program.getSourceFile(path.join(root, 'apps/core/src/main.ts'))!;
  const name = firstImportName(source);
  const checker = program.getTypeChecker();
  return relativePath(root, checker.getAliasedSymbol(checker.getSymbolAtLocation(name)!).declarations![0]!.getSourceFile().fileName);
};

// These are the complete findings and graph recorded before the memory change. Locations, project ownership, type-only
// edges and dependency chains are caller-visible behavior, including the refusals that keep an incomplete graph red.
const expectedErrors = [
  {
    ruleId: 'ARCH_DYNAMIC_DEPENDENCY_UNPROVEN', project: 'tsconfig.json', path: `${LIB}/references.ts`, line: 11, column: 6,
    message: 'dynamic import() must use a string-literal module name so architecture coverage can resolve its dependency.',
  },
  {
    ruleId: 'ARCH_DYNAMIC_DEPENDENCY_UNPROVEN', project: 'tsconfig.json', path: `${LIB}/references.ts`, line: 12, column: 6,
    message: 'dynamic require() must use a string-literal module name so architecture coverage can resolve its dependency.',
  },
  {
    ruleId: 'ARCH_INTERNAL_IMPORT_UNRESOLVED', project: 'tsconfig.json', path: `${LIB}/references.ts`, line: 7, column: 13,
    specifier: './missing', message: 'Internal import ./missing is not resolvable with tsconfig.json.',
  },
  {
    ruleId: 'ARCH_INTERNAL_IMPORT_OUTSIDE', project: 'tsconfig.json', path: `${LIB}/references.ts`, line: 13, column: 23,
    specifier: '../../../../../fe/source',
    message: 'Internal import ../../../../../fe/source leaves the be side for fe/source.ts; nothing crosses the sides of an app.',
  },
];

const expectedEdges = [
  ['apps/core/src/main.ts', 'apps/core/src/compose/local.ts', '@local', true, false, 'apps/core/tsconfig.json', 1, 23],
  [APPLICATION, `${LIB}/cycle-a.ts`, '@library/cycle-a', true, false, 'tsconfig.json', 1, 41],
  [APPLICATION, `${LIB}/barrel.ts`, '@library/barrel', false, false, 'tsconfig.json', 2, 30],
  [`${LIB}/barrel.ts`, `${LIB}/value.ts`, './value', true, true, 'tsconfig.json', 1, 34],
  [`${LIB}/barrel.ts`, `${LIB}/value.ts`, './value', false, true, 'tsconfig.json', 2, 30],
  [`${LIB}/cycle-a.ts`, `${LIB}/cycle-b.ts`, './cycle-b', true, true, 'tsconfig.json', 1, 15],
  [`${LIB}/cycle-a.ts`, `${LIB}/barrel.ts`, './barrel', true, true, 'tsconfig.json', 2, 23],
  [`${LIB}/cycle-b.ts`, `${LIB}/cycle-a.ts`, './cycle-a', true, true, 'tsconfig.json', 1, 15],
  [`${LIB}/cycle-b.ts`, TRANSPORT, '../../../features/api/orders/transport/rest/order.dto', false, true, 'tsconfig.json', 2, 31],
  [`${LIB}/references.ts`, `${LIB}/value.ts`, './value', false, false, 'tsconfig.json', 1, 30],
  [`${LIB}/references.ts`, `${LIB}/value.ts`, './value', false, false, 'tsconfig.json', 2, 31],
  [`${LIB}/references.ts`, `${LIB}/value.ts`, './value', true, false, 'tsconfig.json', 3, 25],
  [`${LIB}/references.ts`, `${LIB}/value.ts`, './value', true, false, 'tsconfig.json', 4, 13],
  [`${LIB}/references.ts`, `${LIB}/value.ts`, './value', true, false, 'tsconfig.json', 5, 14],
];

const expectedBackendFindings = [
  {
    ruleId: 'BE_APPLICATION_TRANSPORT_FRAMEWORK', path: APPLICATION, line: 1, column: 41, specifier: '@library/cycle-a',
    resolvedPath: `${LIB}/cycle-b.ts`, dependencyChain: [APPLICATION, `${LIB}/cycle-a.ts`, `${LIB}/cycle-b.ts`],
    message: 'Feature application code imports protocol surface endpoint re-exported from @nestjs/common through an internal re-export. Keep protocol decorators and types under transport/.',
  },
  {
    ruleId: 'BE_APPLICATION_IMPORTS_TRANSPORT', path: APPLICATION, line: 1, column: 41, specifier: '@library/cycle-a',
    resolvedPath: TRANSPORT, dependencyChain: [APPLICATION, `${LIB}/cycle-a.ts`, `${LIB}/cycle-b.ts`, TRANSPORT],
    message: 'Feature application code cannot depend on transport adapters or DTOs, including through a type import or barrel.',
  },
];

test('type context preserves dependency findings, transitive transport findings and project-owned callable origins', (t) => {
  const root = archFixture(t, { files: fixtureFiles });
  const config = loadArchitectureConfig(root);
  const context = withTypeScriptProgramRun(() => buildTypeScriptContext(config, ts));
  assert.deepEqual(context.errors, expectedErrors);
  assert.deepEqual(relativeEdges(config, context), expectedEdges);
  assert.deepEqual(checkBackend(config, context), expectedBackendFindings);
  const sourceFile = context.files.find((file) => relativePath(root, file.fileName) === APPLICATION)!;
  const checker = context.checkerFor(sourceFile.fileName);
  const importedName = firstImportName(sourceFile);
  const importedSymbol = checker.getSymbolAtLocation(importedName)!;
  const declaration = checker.getAliasedSymbol(importedSymbol).declarations![0]!;
  assert.equal(relativePath(root, declaration.getSourceFile().fileName), `${LIB}/value.ts`);
  assert.equal((declaration as unknown as { name: Identifier }).name.text, 'measure');
  const main = context.files.find((file) => relativePath(root, file.fileName) === 'apps/core/src/main.ts')!;
  const localName = firstImportName(main);
  const mainChecker = context.checkerFor(main.fileName);
  const local = mainChecker.getAliasedSymbol(mainChecker.getSymbolAtLocation(localName)!);
  assert.equal(relativePath(root, local.declarations![0]!.getSourceFile().fileName), 'apps/core/src/compose/local.ts');
  const rootProgram = context.projects.find((project) => project.relative === 'tsconfig.json')!.program;
  const nestedProgram = context.projects.find((project) => project.relative === 'apps/core/tsconfig.json')!.program;
  const mainFile = path.join(root, 'apps/core/src/main.ts');
  assert.notEqual(rootProgram.getSourceFile(mainFile), nestedProgram.getSourceFile(mainFile));
  assert.equal(localOrigin(root, rootProgram), `${LIB}/root-local.ts`);
  assert.equal(localOrigin(root, nestedProgram), 'apps/core/src/compose/local.ts');
  assert.equal(localOrigin(root, rootProgram), `${LIB}/root-local.ts`);
  assert.ok(context.projects.some(project => project.relative === 'apps/core/tsconfig.json'));
  assert.ok(context.projects.some(project => project.relative === 'tsconfig.json'));
  for (const edge of [...context.edges.values()].flat()) {
    assert.equal(path.resolve(edge.sourceFile.fileName), edge.from);
    assert.equal(edge.node.getSourceFile(), edge.sourceFile);
    assert.equal(edge.declaration.getSourceFile(), edge.sourceFile);
  }
});

test('a program run shares compatible parses, isolates parsing modes and releases programs between runs', (t) => {
  const root = archFixture(t, { files: { ...fixtureFiles, 'src/view.tsx': 'export const view = <div />;\n', 'src/plain.ts': 'const plain = 1;\n' } });
  const viewFile = path.join(root, 'src/view.tsx');
  const plainFile = path.join(root, 'src/plain.ts');
  const rootLocal = path.join(root, LIB, 'root-local.ts');
  const options: CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve, noLib: true };
  const build = (rootNames: string[], compiler: CompilerOptions = options) => createTypeScriptProgram(ts, { rootNames, options: compiler });
  const first = withTypeScriptProgramRun(() => {
    const program = build([viewFile, plainFile]);
    assert.equal(build([viewFile, plainFile]), program);
    const overlapping = build([viewFile, plainFile, rootLocal]);
    assert.notEqual(overlapping, program);
    assert.equal(overlapping.getSourceFile(viewFile), program.getSourceFile(viewFile));
    assert.equal(overlapping.getSourceFile(plainFile), program.getSourceFile(plainFile));
    const mainFile = path.join(root, 'apps/core/src/main.ts');
    const rootAlias = build([mainFile], { ...options, baseUrl: root, paths: { '@local': [`${LIB}/root-local.ts`] } });
    const nestedAlias = build([mainFile], { ...options, baseUrl: root, paths: { '@local': ['apps/core/src/compose/local.ts'] } });
    assert.equal(rootAlias.getSourceFile(mainFile), nestedAlias.getSourceFile(mainFile));
    assert.equal(localOrigin(root, rootAlias), `${LIB}/root-local.ts`);
    assert.equal(localOrigin(root, nestedAlias), 'apps/core/src/compose/local.ts');
    assert.equal(localOrigin(root, rootAlias), `${LIB}/root-local.ts`);
    assert.notEqual(build([viewFile], { ...options, target: ts.ScriptTarget.ES2019 }).getSourceFile(viewFile), program.getSourceFile(viewFile));
    assert.notEqual(build([viewFile], { ...options, jsx: ts.JsxEmit.ReactJSX }).getSourceFile(viewFile), program.getSourceFile(viewFile));
    const forced = build([plainFile], { ...options, moduleDetection: ts.ModuleDetectionKind.Force });
    assert.equal(ts.isExternalModule(program.getSourceFile(plainFile)!), false);
    assert.equal(ts.isExternalModule(forced.getSourceFile(plainFile)!), true);
    const nodeProgram = build([plainFile], { ...options, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    assert.equal(nodeProgram.getSourceFile(plainFile)!.impliedNodeFormat, ts.ModuleKind.CommonJS);
    assert.equal(program.getSourceFile(plainFile)!.impliedNodeFormat, undefined);
    return program;
  });
  writeFiles(root, { 'src/plain.ts': 'export const plain = 2;\n' });
  const second = withTypeScriptProgramRun(() => build([viewFile, plainFile]));
  assert.notEqual(first, second);
  assert.notEqual(first.getSourceFile(viewFile), second.getSourceFile(viewFile));
  assert.equal(first.getSourceFile(plainFile)!.text, 'const plain = 1;\n');
  assert.equal(second.getSourceFile(plainFile)!.text, 'export const plain = 2;\n');
  assert.notEqual(build([viewFile, plainFile]), build([viewFile, plainFile]));
});

test('a shared type context gives each caller an independent finding list and a fresh later run', (t) => {
  const root = archFixture(t, { files: fixtureFiles });
  const config = loadArchitectureConfig(root);
  const first = withTypeScriptProgramRun(() => {
    const initial = buildTypeScriptContext(config, ts);
    initial.errors.push({ ruleId: 'CALLER_FINDING', message: 'caller-owned result' });
    const repeated = buildTypeScriptContext(config, ts);
    assert.equal(initial.program, repeated.program);
    assert.notEqual(initial.errors, repeated.errors);
    assert.deepEqual(repeated.errors, expectedErrors);
    return repeated;
  });
  writeFiles(root, { [`${LIB}/references.ts`]: 'export const clean = 1;\n' });
  const later = withTypeScriptProgramRun(() => buildTypeScriptContext(config, ts));
  assert.notEqual(first.program, later.program);
  assert.deepEqual(later.errors, []);
  assert.deepEqual(first.errors, expectedErrors);
});

test('dependency resolution rotates bounded caches without changing edges or unresolved findings', (t) => {
  const repeated = Array.from({ length: 1030 }, () => "void import('./value');");
  repeated.splice(1023, 0, "void import('./missing-before');", "void import('./missing-after');");
  const root = archFixture(t, { files: {
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noLib: true }, include: ['src/**/*', 'apps/**/*'] }),
    'src/value.ts': 'export const value = 1;\n',
    'src/references.ts': repeated.join('\n'),
  } });
  const config = loadArchitectureConfig(root);
  const counts = new Map<unknown, number>();
  let created = 0;
  const tracked = new Proxy(ts, { get(target, key) {
    if (key === 'createModuleResolutionCache') return (...args: Parameters<typeof ts.createModuleResolutionCache>) => {
      created += 1;
      return ts.createModuleResolutionCache(...args);
    };
    if (key === 'resolveModuleName') return (...args: Parameters<typeof ts.resolveModuleName>) => {
      const cache = args[4];
      assert.ok(cache);
      counts.set(cache, (counts.get(cache) ?? 0) + 1);
      return ts.resolveModuleName(...args);
    };
    return Reflect.get(target, key);
  } });
  const uncached = new Proxy(ts, { get(target, key) {
    if (key === 'resolveModuleName') return (specifier: string, from: string, options: CompilerOptions, host: ModuleResolutionHost) => ts.resolveModuleName(specifier, from, options, host);
    return Reflect.get(target, key);
  } });
  const expected = withTypeScriptProgramRun(() => buildTypeScriptContext(config, uncached));
  const actual = withTypeScriptProgramRun(() => buildTypeScriptContext(config, tracked));
  assert.equal(created, 2);
  assert.deepEqual([...counts.values()], [1024, 8]);
  assert.deepEqual(actual.errors, expected.errors);
  assert.deepEqual(actual.errors.map(error => [error.ruleId, error.line, error.specifier]), [
    ['ARCH_INTERNAL_IMPORT_UNRESOLVED', 1024, './missing-before'],
    ['ARCH_INTERNAL_IMPORT_UNRESOLVED', 1025, './missing-after'],
  ]);
  assert.deepEqual(relativeEdges(config, actual), relativeEdges(config, expected));
  assert.equal(relativeEdges(config, actual).length, 1030);
});

for (const mode of ['throws', 'missing']) {
  test(`a shared compiler host preserves TypeScript source membership and diagnostics when reading ${mode}`, t => {
    const root = archFixture(t, { files: { 'src/unreadable.ts': 'export const unreadable = 1;\n' } });
    const file = path.join(root, 'src/unreadable.ts');
    const options = { noLib: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
    const createHost = (compiler: CompilerOptions) => {
      const host = ts.createCompilerHost(compiler);
      const readFile = host.readFile;
      host.readFile = candidate => {
        if (path.resolve(candidate) !== path.resolve(file)) return readFile(candidate);
        if (mode === 'throws') throw new Error('fixture read failed');
        return undefined;
      };
      return host;
    };
    const compiler = new Proxy(ts, { get(target, key) {
      return key === 'createCompilerHost' ? createHost : Reflect.get(target, key);
    } });
    const expected = ts.createProgram({ rootNames: [file], options, host: createHost(options) });
    const actual = withTypeScriptProgramRun(() => createTypeScriptProgram(compiler, { rootNames: [file], options }));
    assert.equal(actual.getSourceFile(file)?.text, mode === 'throws' ? '' : undefined);
    assert.deepEqual(actual.getSourceFiles().map(source => source.fileName), expected.getSourceFiles().map(source => source.fileName));
    const diagnostics = (program: Program) => ts.getPreEmitDiagnostics(program).map(item => ({
      code: item.code, file: item.file?.fileName, start: item.start, message: ts.flattenDiagnosticMessageText(item.messageText, '\n'),
    }));
    assert.deepEqual(diagnostics(actual), diagnostics(expected));
    assert.ok(diagnostics(actual).some(item => item.code === (mode === 'throws' ? 5012 : 6053)));
  });
}

test('equal-depth project owners and files outside all project directories keep the first candidate', (t) => {
  const project = (target: string) => JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noLib: true, baseUrl: '..', paths: { '@choice': [`src/${target}.ts`] } },
    files: ['local.ts', '../src/shared.ts'],
  });
  const root = archFixture(t, { files: {
    'projects/tsconfig.one.json': project('one'), 'projects/tsconfig.two.json': project('two'),
    'projects/local.ts': "import { value } from '@choice';\nexport const local = value;\n",
    'src/shared.ts': "import { value } from '@choice';\nexport const shared = value;\n",
    'src/one.ts': 'export const value = 1;\n', 'src/two.ts': 'export const value = 2;\n',
  } });
  const config = loadArchitectureConfig(root);
  for (const order of [['one', 'two'], ['two', 'one']]) {
    const projects = order.map(name => `projects/tsconfig.${name}.json`);
    const context = withTypeScriptProgramRun(() => buildTypeScriptContext({ ...config, projects }, ts));
    assert.deepEqual(context.errors, []);
    for (const relative of ['projects/local.ts', 'src/shared.ts']) {
      const edges = context.edges.get(path.join(root, relative))!;
      assert.equal(edges.length, 1);
      assert.equal(edges[0]!.project, projects[0]);
      assert.equal(relativePath(root, edges[0]!.to), `src/${order[0]}.ts`);
      assert.equal(context.checkerFor(path.join(root, relative)), context.projects[0]!.program.getTypeChecker());
    }
  }
});

test('multiple source names for one canonical file keep the last occurrence within the owning program', (t) => {
  const root = archFixture(t);
  const canonicalFile = path.join(root, 'src/shared.ts');
  const first = ts.createSourceFile(path.join(root, 'src/alias-a.ts'), 'export const value = 1;', ts.ScriptTarget.ES2022);
  const last = ts.createSourceFile(path.join(root, 'src/alias-b.ts'), 'export const value = 2;', ts.ScriptTarget.ES2022);
  const checker = {};
  // reason: the context reads only these three members of a program.
  const program = { getSourceFiles: () => [first, last], getTypeChecker: () => checker, getSyntacticDiagnostics: () => [] } as unknown as Program;
  const context = contextFromProjects({ root, projects: ['tsconfig.json'] } as unknown as ArchitectureConfig, { ts } as unknown as LoadedTypeScript, [], {
    readTypeScriptProject: () => ({ read: {}, parsed: { errors: [], fileNames: [first.fileName, last.fileName], options: {} } }),
    createTypeScriptProgram: () => program, isProductionSource: () => true, canonical: () => canonicalFile,
    isInside: (parent: string, file: string) => !path.relative(parent, file).startsWith('..'),
    workspaceMetadata: () => [], workspaceOf: () => null, moduleReferences: () => ({ found: [], unproven: [] }),
  } as unknown as TypeContextHelpers);
  assert.deepEqual(context.errors, []);
  assert.deepEqual(context.files, [last]);
  assert.equal(context.checkerFor(canonicalFile), checker);
  assert.equal(context.edges.get(canonicalFile), context.edges.get(path.resolve(last.fileName)));
});
