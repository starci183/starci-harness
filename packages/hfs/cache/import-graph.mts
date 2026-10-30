// import-graph.mts - the resolved local import graph of one lint side, and the dirty set a change in it implies (check-cache.md, ESLint, kind 1).
//
// A type-aware rule's result on a file depends on the files whose types it reads, so ESLint's own per-file cache cannot be trusted. The cache records
// for every file of a side its content hash and the local files it imports (TypeScript `preProcessFile` and `resolveModuleName` under the side's
// tsconfig: static, type-only and dynamic imports, re-exports, `require`, triple-slash references, JSON). The dirty set of a change is every changed,
// added or removed file and every file that reaches one through imports, in the new graph and in the recorded one. Everything here is pure over
// its inputs (the compiler, a file reader, the hashes), so a spec drives it with fixtures and the cache itself stays in lint-family.mts.
import path from 'node:path';
import type TypeScript from 'typescript';

type Ts = typeof TypeScript;

/** One file of the graph: its content hash, the side-relative posix paths of the local files it imports, and whether it declares globals. */
export interface ImportNode { hash: string; imports: string[]; declaresGlobals: boolean }
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

/** The module specifiers and path references a file's text names: static, type-only and dynamic imports, re-exports, `require`, triple-slash paths. */
export function referencesOf(ts: Ts, text: string): { specifiers: string[]; paths: string[] } {
  const info = ts.preProcessFile(text, true, true);
  const specifiers = info.importedFiles.map((imported) => imported.fileName);
  const types = info.typeReferenceDirectives.map((directive) => directive.fileName);
  return { specifiers: [...new Set([...specifiers, ...types])], paths: info.referencedFiles.map((reference) => reference.fileName) };
}

/** The side-relative posix path of an absolute file below the side, or null when it lies outside it or in an installed package. */
function localPath(sideRoot: string, absolute: string): string | null {
  const relative = posix(path.relative(sideRoot, absolute));
  if (relative === '' || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return null;
  return relative.split('/').includes('node_modules') ? null : relative;
}

/** The local files `file` (side-relative) imports, resolved with the side's compiler options. Unresolved and installed-package imports are not edges. */
export function resolveImports(host: GraphHost, options: TypeScript.CompilerOptions, file: string, text: string): string[] {
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
  for (const specifier of specifiers) {
    const resolved = ts.resolveModuleName(specifier, absolute, options, moduleHost).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) continue;
    const local = localPath(sideRoot, resolved.resolvedFileName);
    if (local !== null && local !== file) found.add(local);
  }
  for (const reference of paths) {
    const local = localPath(sideRoot, path.resolve(path.dirname(absolute), reference));
    if (local !== null && host.fileExists(path.join(sideRoot, local))) found.add(local);
  }
  return [...found].sort();
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
    if (!pathsChanged && before !== undefined && before.hash === hash) {
      graph.set(file, before);
      reused += 1;
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
      const text = host.readText(path.join(host.sideRoot, file));
      scanned += 1;
      graph.set(file, text === null
        ? { hash, imports: [], declaresGlobals: false }
        : { hash, imports: resolveImports(host, compiler, file, text), declaresGlobals: declaresGlobals(host.ts, file, text) });
    } else graph.set(file, { hash, imports: [], declaresGlobals: false });
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
 * The files to lint again after a change from `previous` (the recorded graph, null when none) to `next`: every changed path, and every file that
 * reaches one through imports in either graph (a file that stopped importing a changed file still holds a result from the old types). A changed
 * file that declares globals, now or before, dirties the whole side.
 */
export function dirtySetOf(previous: ImportGraph | null, next: ImportGraph): DirtySet {
  const changed = changedPaths(previous, next);
  if (previous === null) return { dirty: new Set(next.keys()), wholeSide: 'no recorded import graph', changed };
  for (const file of changed) {
    if (next.get(file)?.declaresGlobals === true || previous.get(file)?.declaresGlobals === true) {
      return { dirty: new Set(next.keys()), wholeSide: `${file} declares globals`, changed };
    }
  }
  const dirty = new Set<string>([...changed, ...dependentsOf(next, changed), ...dependentsOf(previous, changed)]);
  return { dirty, wholeSide: null, changed };
}
