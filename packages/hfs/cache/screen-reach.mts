// screen-reach.mts - the files a gallery screen renders (contexts/project/gallery.md PROJECT-GALLERY-8 item 3): every local file its route's `page.tsx` reaches through
// imports, resolved by the app's own TypeScript under the front-end app's tsconfig (its `@/` paths), so a change to a shared composite, a hook, a module, a workspace
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

const edges = new Map<string, { mtime: number; imports: string[] }>();
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

/** The module specifiers of the value imports of a source: `import type`, `export type` and imports whose every name is a type are left out. */
function valueSpecifiers(ts: Ts, file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const found = new Set<string>();
  const literal = (node: TypeScript.Node | undefined): string | null => (node !== undefined && ts.isStringLiteralLike(node) ? node.text : null);
  const visit = (node: TypeScript.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly)));
      const name = literal(node.moduleSpecifier);
      if (!typeOnly && name !== null) found.add(name);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      const typeOnly = node.isTypeOnly || (node.exportClause !== undefined && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly));
      const name = literal(node.moduleSpecifier);
      if (!typeOnly && name !== null) found.add(name);
      return;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const name = literal(node.arguments[0]);
      if (name !== null) found.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

/** The local files (absolute, real paths below the repository, never under node_modules) `file` imports. */
function importsOf(ts: Ts, compiler: { options: TypeScript.CompilerOptions; cache: TypeScript.ModuleResolutionCache }, repoRoot: string, file: string): string[] {
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return []; }
  const known = edges.get(file);
  if (known !== undefined && known.mtime === mtime) return known.imports;
  const text = /\.json$/u.test(file) ? null : readText(file);
  const found = new Set<string>();
  if (text !== null) {
    const host: TypeScript.ModuleResolutionHost = { fileExists, readFile: (name) => readText(name) ?? undefined, directoryExists: (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } }, realpath: (name) => { try { return fs.realpathSync(name); } catch { return name; } } };
    for (const specifier of valueSpecifiers(ts, file, text)) {
      const resolved = ts.resolveModuleName(specifier, file, compiler.options, host, compiler.cache).resolvedModule?.resolvedFileName;
      if (resolved === undefined) continue;
      let real = resolved;
      try { real = fs.realpathSync(resolved); } catch { /* keep it */ }
      const relative = posix(path.relative(repoRoot, real));
      if (relative.startsWith('../') || path.isAbsolute(relative) || relative.split('/').includes('node_modules') || /\.d\.[cm]?ts$/u.test(relative) || !SOURCE.test(relative)) continue;
      found.add(real);
    }
  }
  const imports = [...found].sort();
  edges.set(file, { mtime, imports });
  return imports;
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
    let capped = false;
    while (queue.length > 0) {
      if (seen.size > MAX_REACH) { capped = true; break; }
      for (const next of importsOf(ts, compiler, repoRoot, queue.pop() as string)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const reach = { files: new Set([...seen].map((file) => posix(path.relative(repoRoot, file)))), capped, unresolved: false };
    done.set(route.file, reach);
    return reach;
  };
}
