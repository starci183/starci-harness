// import-graph.mts - the resolved local import graph of one lint side, and the dirty set a change in it implies (check-cache.md, ESLint, kind 1).
//
// A type-aware rule's result on a file depends on the files whose types it reads, so ESLint's own per-file cache cannot be trusted. The cache records
// for every file of a side its content hash and the local files it imports (TypeScript `preProcessFile` and `resolveModuleName` under the side's
// tsconfig: static, type-only and dynamic imports, re-exports, `require`, triple-slash references, JSON). The dirty set of a change is every changed,
// added or removed file and every file that reaches one through imports, in the new graph and in the recorded one. Everything here is pure over
// its inputs (the compiler, a file reader, the hashes), so a spec drives it with fixtures and the cache itself stays in lint-family.mts.
import path from 'node:path';
import type TypeScript from 'typescript';
import { DECLARATION, SCRIPT, TYPESCRIPT, declarationSurface } from '../runtime/scripts/lib/declaration-surface.mjs';
import { hashText } from './hash.mjs';

type Ts = typeof TypeScript;

/**
 * One file of the graph: its content hash, the side-relative posix paths of the local files it imports, and whether it declares globals.
 *
 * `api` is the digest of the file's type surface, the text of TypeScript's isolated declaration emit (a source that is not TypeScript, or a
 * declaration file, stands for itself: its content hash). `open` says the surface is inferred: the emit reported a diagnostic (a type the compiler
 * has to infer from the bodies and the files they use), so it can change while the emit text does not. `refs` is the local files the emit names (a
 * type imported from them, a re-export): an explicit surface is its emit text plus the surfaces of those files, nothing else. An absent `api`,
 * `open` or `refs` (a record from before they existed) is read as "changed", "inferred" and "unknown". `packages` is the installed packages the file imports
 * (by package name), whose types a type-aware rule reads too; absent on a record from before it existed, read as "unknown".
 */
export interface ImportNode { hash: string; imports: string[]; declaresGlobals: boolean; api?: string | undefined; open?: boolean | undefined; refs?: string[] | undefined; packages?: string[] | undefined }
/** The graph of a side: side-relative posix path to node. Leaves (a JSON file, a declaration file out of the lint scope) are nodes with no imports. */
export type ImportGraph = ReadonlyMap<string, ImportNode>;

/** What the graph builder reads of the world: the compiler of the app, file text and existence, and the content hash of a path. */
export interface GraphHost {
  ts: Ts;
  /** The absolute folder of the side. */
  sideRoot: string;
  /** The text of an absolute file, or null when it cannot be read. */
  readText: (file: string) => string | null;
  fileExists: (file: string) => boolean;
  directoryExists?: (directory: string) => boolean;
  /** The content hash of a side-relative path the graph reaches (the scope's files and any resolved leaf), or null when it is not a file. */
  hashOf: (relative: string) => string | null;
}

export const posix = (file: string): string => file.replace(/\\/g, '/').replace(/^\.\//, '');

/** The compiler options of the side's own tsconfig (the file the typed ESLint run reads), or the permissive defaults when the side holds none. */
export function compilerOptionsOf(ts: Ts, sideRoot: string, readText: (file: string) => string | null, fileExists: (file: string) => boolean): TypeScript.CompilerOptions {
  const configPath = path.join(sideRoot, 'tsconfig.json');
  if (!fileExists(configPath)) return { allowJs: true, resolveJsonModule: true };
  const read = ts.readConfigFile(configPath, (file) => readText(file) ?? undefined);
  if (read.error || read.config === undefined) return { allowJs: true, resolveJsonModule: true };
  const host: TypeScript.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    readDirectory: () => [],
    fileExists,
    readFile: (file) => readText(file) ?? undefined,
  };
  return { ...ts.parseJsonConfigFileContent(read.config, host, sideRoot).options, resolveJsonModule: true };
}

/**
 * Whether a source file declares globals: a script (a file with no import or export that has statements), a `declare global` block, or a module
 * augmentation (`declare module 'x'` inside a module). A change to such a file can alter the types of any file of the side.
 */
export function declaresGlobals(ts: Ts, fileName: string, text: string): boolean {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  let isModule = false;
  let declaring = false;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) isModule = true;
    else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) isModule = true;
    else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) isModule = true;
    else if (ts.isModuleDeclaration(statement) && (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0) declaring = true;
    else if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name)) declaring = true;
  }
  if (isModule) {
    // inside a module a `declare module 'x'` or `declare global` augments; a plain exported declaration does not
    return source.statements.some((statement) => ts.isModuleDeclaration(statement) && ((statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0 || ts.isStringLiteral(statement.name)));
  }
  return declaring || source.statements.length > 0;
}

/**
 * The module specifiers and path references a file's text names: static, type-only and dynamic imports, re-exports, `require`, import types and
 * triple-slash paths. TypeScript's preprocessor finds most of them without a full parse; the syntax tree adds the forms it misses (a dynamic
 * import of a plain template literal, an `import('x').T` type), so the graph holds every edge the compiler's program would.
 */
export function referencesOf(ts: Ts, text: string): { specifiers: string[]; paths: string[] } {
  const info = ts.preProcessFile(text, true, true);
  const found = new Set<string>([...info.importedFiles.map((imported) => imported.fileName), ...info.typeReferenceDirectives.map((directive) => directive.fileName)]);
  const source = ts.createSourceFile('references.ts', text, ts.ScriptTarget.Latest, false);
  const literal = (node: TypeScript.Node | undefined): string | null => (node !== undefined && ts.isStringLiteralLike(node) ? node.text : null);
  const visit = (node: TypeScript.Node): void => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const name = literal(node.arguments[0]);
      if (name !== null) found.add(name);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const name = literal(node.argument.literal);
      if (name !== null) found.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers: [...found], paths: info.referencedFiles.map((reference) => reference.fileName) };
}

/** The side-relative posix path of an absolute file below the side, or null when it lies outside it or in an installed package. */
function localPath(sideRoot: string, absolute: string): string | null {
  const relative = posix(path.relative(sideRoot, absolute));
  if (relative === '' || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return null;
  return relative.split('/').includes('node_modules') ? null : relative;
}

/** The resolution cache of one compiler-options object: a side's thousands of files share the directory lookups of their (mostly package) imports. */
const resolutionCaches = new WeakMap<object, TypeScript.ModuleResolutionCache>();
const resolutionCacheOf = (ts: Ts, sideRoot: string, options: TypeScript.CompilerOptions): TypeScript.ModuleResolutionCache => {
  let cache = resolutionCaches.get(options);
  if (cache === undefined) {
    cache = ts.createModuleResolutionCache(sideRoot, (name) => name, options);
    resolutionCaches.set(options, cache);
  }
  return cache;
};

/** The package name of a bare specifier (`@s/y/sub` is `@s/y`, `x/sub` is `x`). */
export function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] as string);
}

/** The local files `file` (side-relative) imports, resolved with the side's compiler options, and the installed packages it imports. Unresolved imports are neither. */
export function resolveReferences(host: GraphHost, options: TypeScript.CompilerOptions, file: string, text: string): { imports: string[]; packages: string[] } {
  const { ts, sideRoot } = host;
  const absolute = path.join(sideRoot, file);
  const { specifiers, paths } = referencesOf(ts, text);
  const moduleHost: TypeScript.ModuleResolutionHost = {
    fileExists: host.fileExists,
    readFile: (name) => host.readText(name) ?? undefined,
    directoryExists: host.directoryExists ?? (() => true),
    getCurrentDirectory: () => sideRoot,
  };
  const found = new Set<string>();
  const packages = new Set<string>();
  for (const specifier of specifiers) {
    const resolved = ts.resolveModuleName(specifier, absolute, options, moduleHost, resolutionCacheOf(ts, sideRoot, options)).resolvedModule;
    if (!resolved) continue;
    if (resolved.isExternalLibraryImport === true) {
      if (!specifier.startsWith('.')) packages.add(packageOf(specifier));
      continue;
    }
    const local = localPath(sideRoot, resolved.resolvedFileName);
    if (local !== null && local !== file) found.add(local);
  }
  for (const reference of paths) {
    const local = localPath(sideRoot, path.resolve(path.dirname(absolute), reference));
    if (local !== null && host.fileExists(path.join(sideRoot, local))) found.add(local);
  }
  return { imports: [...found].sort(), packages: [...packages].sort() };
}

/** The local files `file` (side-relative) imports (`resolveReferences` without the packages). */
export function resolveImports(host: GraphHost, options: TypeScript.CompilerOptions, file: string, text: string): string[] {
  return resolveReferences(host, options, file, text).imports;
}

/**
 * The type surface of one source file: the digest of its isolated declaration emit (`ts.transpileDeclaration`, TypeScript 5.5 and later, which reads the
 * file alone) and whether it is open. A body-only edit leaves the emit, and so the digest, as it was; a changed signature, export list or doc comment
 * (`@deprecated` is read by lint rules) changes it. A compiler without `transpileDeclaration` gives no digest, which every reader takes as changed.
 * `open` is true when the emit reported a diagnostic (the compiler must infer a type); `refs` is the local files the emit names.
 */
export function surfaceOf(host: GraphHost, options: TypeScript.CompilerOptions, file: string, text: string): { api: string | undefined; open: boolean; refs: string[] | undefined } {
  const { ts } = host;
  if (DECLARATION.test(file) || SCRIPT.test(file)) return { api: hashText(text), open: true, refs: undefined };
  if (!TYPESCRIPT.test(file)) return { api: hashText(text), open: false, refs: [] };
  try {
    const surface = declarationSurface(ts, file, text, options.module);
    if (surface === null) return { api: undefined, open: true, refs: undefined };
    // the classifier is the one the explicit-export-surface rule of the canons reports with: a file is open exactly when it has a problem
    return { api: hashText(surface.outputText), open: surface.problems.length > 0, refs: resolveImports(host, options, file, surface.outputText) };
  } catch {
    return { api: undefined, open: true, refs: undefined };
  }
}

/** What a build reports of its work. */
export interface GraphBuild { graph: Map<string, ImportNode>; reused: number; scanned: number; resolvedAgain: boolean }

/**
 * The import graph of `files` (the side's lint scope, side-relative posix) and the leaves they reach.
 *
 * A file whose recorded hash equals its hash now reuses its recorded imports, unless a path of the side was added or removed since the record:
 * a new file can change where an unchanged import resolves, so every file is then resolved again. `pathsChanged` lets the caller report a change in
 * the side's paths the scope does not list (a JSON file, a generated declaration).
 */
export function buildImportGraph(host: GraphHost, files: readonly string[], recorded: ImportGraph | null, options: { pathsChanged?: boolean } = {}): GraphBuild {
  const compiler = compilerOptionsOf(host.ts, host.sideRoot, host.readText, host.fileExists);
  const known = new Set(files);
  const pathsChanged = options.pathsChanged === true || recorded === null || recorded.size === 0
    || files.some((file) => !recorded.has(file))
    || [...recorded.keys()].some((file) => !known.has(file) && host.hashOf(file) === null);
  const graph = new Map<string, ImportNode>();
  let reused = 0, scanned = 0;
  const visit = (file: string): void => {
    if (graph.has(file)) return;
    const hash = host.hashOf(file);
    if (hash === null) return;
    const before = recorded?.get(file);
    // a record from before the type surface was kept has none: the file is read once more to give it one
    if (!pathsChanged && before !== undefined && before.hash === hash && ((before.api !== undefined && before.packages !== undefined) || !/\.(?:[cm]?[jt]sx?)$/.test(file))) {
      graph.set(file, before);
      reused += 1;
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
      const text = host.readText(path.join(host.sideRoot, file));
      scanned += 1;
      graph.set(file, text === null
        ? { hash, imports: [], declaresGlobals: false, api: undefined, open: true, refs: undefined }
        : { hash, ...resolveReferences(host, compiler, file, text), declaresGlobals: declaresGlobals(host.ts, file, text), ...surfaceOf(host, compiler, file, text) });
    } else graph.set(file, { hash, imports: [], declaresGlobals: false, api: hash, open: false, refs: [] });
    for (const next of graph.get(file)?.imports ?? []) visit(next);
  };
  for (const file of files) visit(file);
  return { graph, reused, scanned, resolvedAgain: pathsChanged };
}

/** Every path whose node differs between two graphs: added, removed, or with another hash. */
export function changedPaths(previous: ImportGraph | null, next: ImportGraph): Set<string> {
  const changed = new Set<string>();
  for (const [file, node] of next) if (previous?.get(file)?.hash !== node.hash) changed.add(file);
  for (const file of previous?.keys() ?? []) if (!next.has(file)) changed.add(file);
  return changed;
}

/** The files that reach any of `seeds` through imports in `graph` (the seeds themselves are not added unless a cycle reaches them). */
export function dependentsOf(graph: ImportGraph, seeds: Iterable<string>): Set<string> {
  const importers = new Map<string, string[]>();
  for (const [file, node] of graph) for (const target of node.imports) importers.set(target, [...(importers.get(target) ?? []), file]);
  const reached = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    for (const importer of importers.get(queue.pop() as string) ?? []) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      queue.push(importer);
    }
  }
  return reached;
}

/** The dirty set of a side: what must be linted again, or the whole side with the reason. */
export interface DirtySet { dirty: Set<string>; wholeSide: string | null; changed: Set<string> }

/**
 * The files to lint again after a change from `previous` (the recorded graph, null when none) to `next`.
 *
 * A file is dirty when it changed, was added or removed, resolves its imports to other files than recorded, imports an installed package whose
 * install changed (`changedPackages`; its surface counts as changed, since it may re-export the package's types), or imports a file whose type surface
 * changed, in the new graph or the recorded one (a file that stopped importing such a file still holds a result from the old types). A dirty file's
 * surface changed when it was added or removed, gained an import, its surface digest differs from the record (or either is unknown), its surface
 * is inferred (`open`: whatever dirtied it can have changed the inferred type), or its explicit surface names a file (`refs`) whose surface changed.
 * An explicit surface is its emit text and the surfaces of the files it names, so a body-only edit of such a file dirties that file alone, a
 * changed signature its direct importers, and a type it re-exports or names carries on through the files that name it. A changed file that
 * declares globals, now or before, dirties the whole side.
 */
export function dirtySetOf(previous: ImportGraph | null, next: ImportGraph, changedPackages: ReadonlySet<string> = new Set()): DirtySet {
  const changed = changedPaths(previous, next);
  if (previous === null) return { dirty: new Set(next.keys()), wholeSide: 'no recorded import graph', changed };
  for (const file of changed) {
    if (next.get(file)?.declaresGlobals === true || previous.get(file)?.declaresGlobals === true) {
      return { dirty: new Set(next.keys()), wholeSide: `${file} declares globals`, changed };
    }
  }
  // a file whose imports resolve elsewhere now (a new file shadows a module, a missing one appeared) reads other types than before
  const rewired = new Set([...next].filter(([file, node]) => {
    const before = previous.get(file);
    return before !== undefined && before.hash === node.hash && JSON.stringify(before.imports) !== JSON.stringify(node.imports);
  }).map(([file]) => file));
  const importers = new Map<string, Set<string>>();
  for (const graph of [next, previous]) for (const [file, node] of graph) for (const target of node.imports) {
    const known = importers.get(target) ?? new Set<string>();
    known.add(file);
    importers.set(target, known);
  }
  // a file that imports a package whose install changed reads other types than before, and so may say other types to its importers
  const repackaged = new Set([...next].filter(([, node]) => changedPackages.size > 0 && (node.packages === undefined || node.packages.some((name) => changedPackages.has(name)))).map(([file]) => file));
  const dirty = new Set<string>([...changed, ...rewired, ...repackaged]);
  const surface = new Set<string>();
  const surfaceChanged = (file: string): boolean => {
    const after = next.get(file), before = previous.get(file);
    if (after === undefined || before === undefined || repackaged.has(file)) return true;
    // a new edge can resolve a name the emit already used to a file that was not there, so what the importers read of this file may differ
    if (rewired.has(file) && after.imports.some((target) => !before.imports.includes(target))) return true;
    if (after.hash !== before.hash && (after.api === undefined || before.api === undefined || after.api !== before.api)) return true;
    if (after.open !== false || before.open !== false || after.refs === undefined || before.refs === undefined) return true;
    return [...after.refs, ...before.refs].some((target) => surface.has(target));
  };
  const queue = [...dirty];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (surface.has(file) || !surfaceChanged(file)) continue;
    surface.add(file);
    for (const importer of importers.get(file) ?? []) {
      // a file already judged to keep its surface is looked at again: the file that just changed may be one its surface names
      if (!dirty.has(importer)) dirty.add(importer);
      queue.push(importer);
    }
  }
  return { dirty, wholeSide: null, changed };
}
