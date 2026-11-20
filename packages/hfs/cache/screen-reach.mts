// screen-reach.mts - the files a gallery screen renders (contexts/project/gallery.md PROJECT-GALLERY-8 item 3): every local file its route's `page.tsx` reaches through
// imports (an import of a pure re-export barrel reaches only the modules that export the names it takes; the barrel itself is never a reached file), resolved by the app's own TypeScript under the front-end app's tsconfig (its `@/` paths), so a change to a shared composite, a hook, a module, a workspace
// package or an imported i18n catalog marks every screen that renders it as touched. Only value edges count (static and dynamic imports, re-exports, require): a type-only
// import or re-export renders nothing, and following it would tie every screen that shares a types module to every component it names. The walk is bounded (MAX_REACH files per app) and the edges of a file are memoised by path and mtime for the process, so the
// gate walks each file once however many screens share it.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type TypeScript from 'typescript';
import type { FeRoute } from '../runtime/scripts/hfs/gallery-routes.mjs';
import { compilerOptionsOf } from './import-graph.mjs';

type Ts = typeof TypeScript;

/** The most files one app's walk reads; past it the reach stops growing and says it was capped. */
export const MAX_REACH = 6000;

const edges = new Map<string, { mtime: number; node: GraphNode }>();
const compilers = new Map<string, { options: TypeScript.CompilerOptions; cache: TypeScript.ModuleResolutionCache }>();

const posix = (file: string): string => file.replace(/\\/g, '/');
const SOURCE = /\.(?:[cm]?[jt]sx?|json)$/u;

/** The app's TypeScript (resolved from the front-end app, then the app root), or null when none is installed. */
function typescriptOf(repoRoot: string, appDir: string): Ts | null {
  for (const from of [path.join(repoRoot, ...appDir.split('/'), 'package.json'), path.join(repoRoot, 'package.json')]) {
    try { return createRequire(from)('typescript') as Ts; } catch { /* the next place */ }
  }
  return null;
}

const readText = (file: string): string | null => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const fileExists = (file: string): boolean => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/** One value import of a source: the module it names and the names it takes from it (null: all of it, a side-effect, default, namespace or require import). */
interface Use { specifier: string; names: string[] | null }
/** One re-export statement of a barrel: `export { original as exported } from`, `export * from` or `export * as exported from`. */
interface Reexport { kind: 'named' | 'star' | 'namespace'; exported: string; original: string; specifier: string }

/** What one source holds: its value imports with the names taken and, when every statement is a re-export, the re-exports of that barrel. */
function analyse(ts: Ts, file: string, text: string): { uses: Use[]; barrel: Reexport[] | null } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const uses = new Map<string, Use>();
  const literal = (node: TypeScript.Node | undefined): string | null => (node !== undefined && ts.isStringLiteralLike(node) ? node.text : null);
  const note = (specifier: string, names: string[] | null): void => {
    const known = uses.get(specifier);
    if (known === undefined) uses.set(specifier, { specifier, names });
    else known.names = known.names === null || names === null ? null : [...new Set([...known.names, ...names])];
  };
  const reexports: Reexport[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const named = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements.filter((element) => !element.isTypeOnly) : null;
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && named !== null && named.length === 0));
      const name = literal(node.moduleSpecifier);
      if (!typeOnly && name !== null) note(name, clause !== undefined && clause.name === undefined && named !== null ? named.map((element) => (element.propertyName ?? element.name).text) : null);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      const typeOnly = node.isTypeOnly || (node.exportClause !== undefined && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly));
      const name = literal(node.moduleSpecifier);
      if (!typeOnly && name !== null) {
        const clause = node.exportClause;
        if (clause === undefined) { reexports.push({ kind: 'star', exported: '*', original: '*', specifier: name }); note(name, null); }
        else if (ts.isNamespaceExport(clause)) { reexports.push({ kind: 'namespace', exported: clause.name.text, original: '*', specifier: name }); note(name, null); }
        else {
          const kept = clause.elements.filter((element) => !element.isTypeOnly);
          for (const element of kept) reexports.push({ kind: 'named', exported: element.name.text, original: (element.propertyName ?? element.name).text, specifier: name });
          note(name, kept.map((element) => (element.propertyName ?? element.name).text));
        }
      }
      return;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const name = literal(node.arguments[0]);
      if (name !== null) note(name, null);
    }
    ts.forEachChild(node, visit);
  };
  let pure = source.statements.length > 0;
  for (const statement of source.statements) {
    const reexport = ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined;
    const typeImport = ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true;
    if (!reexport && !typeImport) pure = false;
    visit(statement);
  }
  return { uses: [...uses.values()], barrel: pure && reexports.length > 0 ? reexports : null };
}

/** A source in the walk: the local files it imports with the names taken, and its re-exports (resolved) when it is a pure barrel. */
interface GraphNode { imports: Array<{ file: string; names: string[] | null }>; barrel: Array<Reexport & { file: string }> | null }

function nodeOf(ts: Ts, compiler: { options: TypeScript.CompilerOptions; cache: TypeScript.ModuleResolutionCache }, repoRoot: string, file: string): GraphNode {
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return { imports: [], barrel: null }; }
  const known = edges.get(file);
  if (known !== undefined && known.mtime === mtime) return known.node;
  const text = /\.json$/u.test(file) ? null : readText(file);
  const imports: GraphNode['imports'] = [];
  let barrel: GraphNode['barrel'] = null;
  if (text !== null) {
    const host: TypeScript.ModuleResolutionHost = { fileExists, readFile: (name) => readText(name) ?? undefined, directoryExists: (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } }, realpath: (name) => { try { return fs.realpathSync(name); } catch { return name; } } };
    const local = (specifier: string): string | null => {
      const resolved = ts.resolveModuleName(specifier, file, compiler.options, host, compiler.cache).resolvedModule?.resolvedFileName;
      if (resolved === undefined) return null;
      let real = resolved;
      try { real = fs.realpathSync(resolved); } catch { /* keep it */ }
      const relative = posix(path.relative(repoRoot, real));
      if (relative.startsWith('../') || path.isAbsolute(relative) || relative.split('/').includes('node_modules') || /\.d\.[cm]?ts$/u.test(relative) || !SOURCE.test(relative)) return null;
      return real;
    };
    const { uses, barrel: reexports } = analyse(ts, file, text);
    for (const use of uses) {
      const real = local(use.specifier);
      if (real !== null) imports.push({ file: real, names: use.names });
    }
    if (reexports !== null) barrel = reexports.flatMap((reexport) => { const real = local(reexport.specifier); return real === null ? [] : [{ ...reexport, file: real }]; });
  }
  imports.sort((a, b) => (a.file < b.file ? -1 : Number(a.file > b.file)));
  const node = { imports, barrel };
  edges.set(file, { mtime, node });
  return node;
}

/** What a screen's route reaches: app-root relative posix files, and whether the walk stopped at MAX_REACH or had no TypeScript to resolve with. */
export interface ScreenReach { files: Set<string>; capped: boolean; unresolved: boolean }

/** A reach finder over one repository: `reachOf(route)` walks the route's page once and memoises the result per route file. */
export function screenReacher(repoRoot: string): (route: FeRoute) => ScreenReach {
  const done = new Map<string, ScreenReach>();
  return (route) => {
    const cached = done.get(route.file);
    if (cached !== undefined) return cached;
    const appDir = route.file.split('/').slice(0, 3).join('/');
    const ts = typescriptOf(repoRoot, appDir);
    if (ts === null) {
      const none = { files: new Set<string>(), capped: false, unresolved: true };
      done.set(route.file, none);
      return none;
    }
    const appRoot = path.join(repoRoot, ...appDir.split('/'));
    let compiler = compilers.get(appRoot);
    if (compiler === undefined) {
      const options = compilerOptionsOf(ts, appRoot, readText, fileExists);
      compiler = { options, cache: ts.createModuleResolutionCache(appRoot, (name) => name, options) };
      compilers.set(appRoot, compiler);
    }
    const start = path.join(repoRoot, ...route.file.split('/'));
    const seen = new Set<string>([start]);
    const queue = [start];
    const demanded = new Set<string>();
    const resolver = compiler;
    let capped = false;
    // An import of a pure re-export barrel reaches only the modules that export the names it takes (the barrel itself renders nothing); any other file is reached whole.
    const take = (file: string, names: string[] | null): void => {
      const node = nodeOf(ts, resolver, repoRoot, file);
      if (node.barrel === null) {
        if (!seen.has(file)) { seen.add(file); queue.push(file); }
        return;
      }
      const key = `${file}|${names === null ? '*' : [...names].sort().join(',')}`;
      if (demanded.has(key)) return;
      demanded.add(key);
      const explicit = node.barrel.filter((reexport) => reexport.kind !== 'star');
      const unmatched = names === null || names.some((name) => !explicit.some((reexport) => reexport.exported === name));
      for (const reexport of node.barrel) {
        if (reexport.kind === 'star') { if (unmatched) take(reexport.file, names); }
        else if (names === null || names.includes(reexport.exported)) take(reexport.file, reexport.kind === 'named' ? [reexport.original] : null);
      }
    };
    while (queue.length > 0) {
      if (seen.size > MAX_REACH) { capped = true; break; }
      for (const next of nodeOf(ts, resolver, repoRoot, queue.pop() as string).imports) take(next.file, next.names);
    }
    const result = { files: new Set([...seen].map((file) => posix(path.relative(repoRoot, file)))), capped, unresolved: false };
    done.set(route.file, result);
    return result;
  };
}
