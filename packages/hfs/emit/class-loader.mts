/**
 * How an emit worker reads an app without booting it: the module graph from source (static-graph.mts), then only the classes it names,
 * loaded through the repository's own TypeScript. A dependency of those classes that cannot load here (configuration read at import time,
 * a native addon, an ES-only package; only requires written in the repository's own source) is replaced by a stand-in and reported on
 * stderr, because a contract depends on the decorated classes, never on what they call. Both the GraphQL worker (schema-worker.mts) and the
 * REST worker (rest-worker.mts) read an app this way.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type TypeScript from 'typescript';
import { aliasTarget, aliasesOf, type PathAlias } from './contracts.mjs';
import { compilerOptionsOf } from './compiler.mjs';
import { createGraphReader } from './static-graph.mjs';
import type { ClassRef } from './static-graph.mjs';

/** The app under emission: its root, its own require, TypeScript and path aliases, and the graph reader over its source. */
export interface AppSource {
  readonly repoRoot: string;
  readonly require: NodeJS.Require;
  readonly ts: typeof TypeScript;
  readonly aliases: readonly PathAlias[];
  readonly graph: ReturnType<typeof createGraphReader>;
}

/** The source view of the repository at `repoRoot`: its TypeScript, its tsconfig path aliases and a graph reader that resolves through them. */
export function appSource(repoRoot: string): AppSource {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const ts: typeof TypeScript = require('typescript');
  const config = ts.readConfigFile(path.join(repoRoot, 'tsconfig.json'), ts.sys.readFile).config ?? {};
  const aliases = aliasesOf(config.compilerOptions?.paths, repoRoot);
  const isFile = (candidate: string) => fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  const host = {
    read: (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null),
    resolve(from: string, specifier: string) {
      const aliased = aliasTarget(aliases, specifier);
      if (aliased === null && !specifier.startsWith('.')) return null;
      const base = (aliased ?? path.resolve(path.dirname(from), specifier)).replace(/\.js$/, '');
      const found = [base, `${base}.ts`, path.join(base, 'index.ts')].find(isFile);
      if (!found) throw new Error(`${from}: cannot resolve ${specifier}`);
      return found;
    },
  };
  return { repoRoot, require, ts, aliases, graph: createGraphReader({ ts, host }) };
}

/** A value that stands for anything: callable, constructible, every property itself. */
export const stand: () => void = new Proxy(function standIn() {}, {
  get: (_, key) => (key === '__esModule' ? true : key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : stand),
  apply: () => stand,
  construct: () => stand,
});

/**
 * Installs the loader of `source` for the files `roots` (and what they import) and answers `classOf`, which loads one class by file and name.
 * The code is compiled the way `tsc` compiles it (a Program over the roots), not file by file: `emitDecoratorMetadata` writes the type of a
 * decorated property from the type checker, which a per-file transpile cannot know and which decides contract field types.
 */
export function installLoader(source: AppSource, roots: readonly string[]): (ref: ClassRef) => unknown {
  const { repoRoot, require, ts, aliases } = source;
  require('reflect-metadata');
  const Module = require('node:module');
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolve(request: string, ...rest: unknown[]) {
    return resolveFilename.call(this, aliasTarget(aliases, request) ?? request, ...rest);
  };
  const options = compilerOptionsOf(ts, repoRoot, (message: string) => process.stderr.write(`stand-in ${message}
`));
  const program = ts.createProgram({ rootNames: [...new Set(roots)], options });
  const compile = (filename: string) => {
    const sourceFile = program.getSourceFile(filename);
    if (!sourceFile) return ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: options }).outputText;
    let output = '';
    program.emit(sourceFile, (name: string, text: string) => { if (name.endsWith('.js')) output = text; });
    return output;
  };
  // reason: Module#_compile is Node's internal compile hook; the typings of Module do not declare it.
  require.extensions['.ts'] = (module: any, filename: string) => module._compile(compile(filename), filename);
  let depth = 0;
  const load = Module._load;
  Module._load = function tolerantLoad(request: string, parent: { filename?: unknown } | undefined, isMain: boolean) {
    depth += 1;
    try {
      return load.call(this, request, parent, isMain);
    } catch (error) {
      const fromSource = typeof parent?.filename === 'string' && parent.filename.startsWith(repoRoot) && !parent.filename.includes(`${path.sep}node_modules${path.sep}`);
      if (depth === 1 || !fromSource) throw error;
      process.stderr.write(`stand-in ${request} (from ${parent?.filename ?? '?'}): ${String((error as Error | undefined)?.message ?? error).split('\n')[0]}\n`);
      return stand;
    } finally {
      depth -= 1;
    }
  };
  return ({ file, name }: ClassRef) => {
    const exported = require(file)[name];
    if (typeof exported !== 'function') throw new Error(`${file} does not export the class ${name}`);
    return exported;
  };
}
