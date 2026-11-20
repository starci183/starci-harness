// integration-specs.mts - the TypeScript judge of a back end's spec files: each file parsed as a syntax tree, its imports resolved
// through the side's tsconfig (paths included) with the app's own TypeScript, the one every back end installs; the runtime's
// TypeScript is the fallback. test-infra-placement.mts reads specs through it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../lib/package-at.mjs';
import { readText } from './read.mjs';
import type { Parsed, Ts } from './rule-types.mjs';


const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The TypeScript compiler of the app (else of the runtime), or null. */
export const typescriptFor = (repoRoot: string) => loadTypescript(repoRoot, HERE);

/** The compiler options of the side (its tsconfig.json, `extends` and `paths` resolved by TypeScript itself). */
function optionsOf(ts: Ts, sideRoot: Parsed) {
  const file = path.join(sideRoot, 'tsconfig.json');
  if (!fs.existsSync(file)) return {};
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) return {};
  return ts.parseJsonConfigFileContent(read.config, ts.sys, sideRoot).options;
}

/** One parsed file: its syntax tree and its imports (local name -> { source, imported }). */
function parse(ts: Ts, repoRoot: string, rel: string) {
  const text = readText(repoRoot, rel);
  if (text === null) return null;
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) imports.set(element.name.text, { source: statement.moduleSpecifier.text, imported: (element.propertyName ?? element.name).text, node: element });
  }
  return { rel, sourceFile, imports };
}

/** The initializer of `const <name> = ...` at the top level of `file`. */
function topLevelConst(ts: Ts, file: Parsed, name: string) {
  for (const statement of file.sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return declaration.initializer;
    }
  }
  return null;
}

/**
 * The judge of one app: resolves an import of a parsed file to a repository-relative path, finds the top-level const of a file,
 * and reads files once.
 */
export function judgeOf(ts: Ts, repoRoot: string, side: string) {
  const options = optionsOf(ts, path.join(repoRoot, side));
  const cache = new Map();
  const parsed = (rel: string) => {
    if (!cache.has(rel)) cache.set(rel, parse(ts, repoRoot, rel));
    return cache.get(rel);
  };
  const resolve = (fromRel: string, source: Parsed) => {
    const resolved = ts.resolveModuleName(source, path.join(repoRoot, fromRel), options, ts.sys).resolvedModule?.resolvedFileName;
    if (!resolved) return null;
    const rel = path.relative(repoRoot, resolved).split(path.sep).join('/');
    return rel.startsWith('..') ? null : rel;
  };
  return { parsed, resolve, constOf: (file: string, name: string) => topLevelConst(ts, file, name) };
}


