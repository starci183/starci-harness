// source-ast.mjs - the syntax-tree reading the runtime rules share (scripts/hfs/runtime-check.mjs): one TypeScript parse
// per runtime source file, never a text grep. Pure: every function takes a source text and returns facts about it.
//   parseSource(text, file)       the TypeScript SourceFile (JS script kind for .mjs/.cjs/.js)
//   moduleRefs(source)            every import/export-from/require()/import() of a string specifier: [{module, line}]
//   relativeImports(source)       the relative specifiers among them: [{specifier, line, column}]
//   localBindings(source)         every name the file declares (variables, functions, classes, parameters, imports)
//   exportedNames(source)         the names the module exports (export function/const/class, export {a as b}, default)
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Parsed } from '../rules/rule-types.mjs';

let typescript = null;
/** The TypeScript compiler, loaded once from the runtime's own dependencies. */
export const ts = () => (typescript ??= createRequire(import.meta.url)('typescript'));

const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);

/** `node` is a string literal naming an fs module specifier ('fs', 'node:fs', 'fs/promises', 'node:fs/promises'). */
const fsSpecifier = (t: Parsed, node: Parsed) => Boolean(node && t.isStringLiteralLike(node) && FS_MODULES.has(node.text));

/** `node` is a `require('fs' | 'node:fs' | 'fs/promises' | 'node:fs/promises')` call. */
const fsRequireCall = (t: Parsed, node: Parsed) => node && t.isCallExpression(node) && t.isIdentifier(node.expression) && node.expression.text === 'require' && fsSpecifier(t, node.arguments[0]);

function bindImport(t: Parsed, node: Parsed, wanted: Parsed, namespaces: Parsed, members: Parsed) {
  if (!t.isImportDeclaration(node) || !fsSpecifier(t, node.moduleSpecifier)) return;
  const clause = node.importClause;
  if (clause?.name) namespaces.add(clause.name.text);
  const bindings = clause?.namedBindings;
  if (bindings && t.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  if (bindings && t.isNamedImports(bindings)) for (const element of bindings.elements) {
    const imported = (element.propertyName ?? element.name).text;
    if (imported === 'promises') namespaces.add(element.name.text);
    else if (wanted(imported)) members.set(element.name.text, imported);
  }
}

function requiredName(t: Parsed, element: Parsed) {
  if (element.propertyName && t.isIdentifier(element.propertyName)) return element.propertyName.text;
  if (t.isIdentifier(element.name)) return element.name.text;
  return null;
}

function bindRequire(t: Parsed, node: Parsed, wanted: Parsed, namespaces: Parsed, members: Parsed, destructuredRequires: Parsed) {
  if (!t.isVariableDeclaration(node) || !node.initializer || !fsRequireCall(t, node.initializer)) return;
  if (t.isIdentifier(node.name)) namespaces.add(node.name.text);
  else if (destructuredRequires && t.isObjectBindingPattern(node.name)) for (const element of node.name.elements) {
    const imported = requiredName(t, element);
    if (imported && wanted(imported) && t.isIdentifier(element.name)) members.set(element.name.text, imported);
  }
}

/**
 * The fs bindings a parsed source declares: `{ namespaces, members }`. `namespaces` holds the local names bound to
 * a whole fs module - a default or namespace import, a `promises` named import, `const fs = require('fs')`.
 * `members` is a Map(local name -> imported name) of named imports `wanted` accepts, plus the names of a
 * `const {x} = require('fs')` destructure unless `destructuredRequires` is false.
 */
export function fsBindings(source: Parsed, wanted: Parsed, { destructuredRequires = true } = {}) {
  const t = ts();
  const namespaces = new Set();
  const members = new Map();
  const bind = (node: Parsed) => {
    bindImport(t, node, wanted, namespaces, members);
    bindRequire(t, node, wanted, namespaces, members, destructuredRequires);
    t.forEachChild(node, bind);
  };
  bind(source);
  return { namespaces, members };
}

/** The fs member `callee` (a property access: `fs.X`, `fs.promises.X`) reaches through `namespaces`, or null. */
export const fsMemberAccess = (t: Parsed, callee: Parsed, namespaces: Parsed, wanted: Parsed) => {
  if (!t.isPropertyAccessExpression(callee) || !wanted(callee.name.text)) return null;
  const target = callee.expression;
  if (t.isIdentifier(target) && namespaces.has(target.text)) return callee.name.text;
  if (t.isPropertyAccessExpression(target) && target.name.text === 'promises' && t.isIdentifier(target.expression) && namespaces.has(target.expression.text)) return callee.name.text;
  return null;
};

/** The SourceFile of `text`; `.ts` files parse as TypeScript, everything else as JavaScript. */
export function parseSource(text: string, file = 'x.mjs') {
  const t = ts();
  return t.createSourceFile(file, String(text), t.ScriptTarget.Latest, true, file.endsWith('.ts') ? t.ScriptKind.TS : t.ScriptKind.JS);
}

/** The 1-based line of `node` in `source`. */
export const lineOf = (source: Parsed, node: Parsed) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/** Every module reference of a parsed file: static imports, re-exports, require('x') and import('x') with a string specifier. */
export function moduleRefs(source: Parsed) {
  const t = ts();
  const out: Parsed[] = [];
  const visit = (node: Parsed) => {
    if ((t.isImportDeclaration(node) || t.isExportDeclaration(node)) && node.moduleSpecifier && t.isStringLiteralLike(node.moduleSpecifier)) {
      out.push({ module: node.moduleSpecifier.text, line: lineOf(source, node), column: source.getLineAndCharacterOfPosition(node.getStart(source)).character + 1 });
    } else if (t.isCallExpression(node) && node.arguments.length && t.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if ((t.isIdentifier(callee) && callee.text === 'require') || callee.kind === t.SyntaxKind.ImportKeyword) {
        out.push({ module: node.arguments[0].text, line: lineOf(source, node), column: source.getLineAndCharacterOfPosition(node.getStart(source)).character + 1 });
      }
    }
    t.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** The relative module references (`./x.mjs`, `../y.mjs`) of a parsed file. */
const relativeImports = (source: Parsed) => moduleRefs(source).filter((ref) => ref.module.startsWith('.')).map((ref) => ({ specifier: ref.module, line: ref.line, column: ref.column }));

/**
 * Exact relative runtime module targets from the shared AST. Tracked targets participate in the owner graph;
 * an existing ignored generated target remains outside it. An absent target cannot silently remove an edge.
 */
export function relativeImportTargets(ctx: Parsed, file: string) {
  return relativeImports(ctx.parsed(file)).map((ref) => {
    const to = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref.specifier));
    const tracked = ctx.fileSet.has(to);
    const missing = ctx.read(to) == null;
    return { ...ref, to, tracked, missing };
  });
}

/** Adds the names `name` binds (an identifier, or the elements of a destructuring pattern) to `names`. */
function addBoundNames(t: Parsed, name: Parsed, names: Parsed) {
  if (!name) return;
  if (t.isIdentifier(name)) names.add(name.text);
  else if (t.isObjectBindingPattern(name) || t.isArrayBindingPattern(name)) for (const el of name.elements) if (!t.isOmittedExpression(el)) addBoundNames(t, el.name, names);
}

const isNamedDeclaration = (t: Parsed, node: Parsed) => (t.isFunctionDeclaration(node) || t.isClassDeclaration(node) || t.isFunctionExpression(node) || t.isClassExpression(node)) && node.name;

/** Adds the local name `node` binds, when it binds one, to `names`. */
function addNodeBindings(t: Parsed, node: Parsed, names: Parsed) {
  if (t.isVariableDeclaration(node) || t.isParameter(node)) addBoundNames(t, node.name, names);
  else if (isNamedDeclaration(t, node)) names.add(node.name.text);
  else if (t.isImportClause(node) && node.name) names.add(node.name.text);
  else if (t.isNamespaceImport(node) || t.isImportSpecifier(node)) names.add(node.name.text);
}

/** Every local name a parsed file binds: variable and parameter names (destructuring included), functions, classes, imports. */
export function localBindings(source: Parsed) {
  const t = ts();
  const names = new Set();
  const visit = (node: Parsed) => {
    addNodeBindings(t, node, names);
    t.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function variableExports(t: Parsed, node: Parsed, source: Parsed) {
  const out = [];
  for (const declaration of node.declarationList.declarations) {
    if (!t.isIdentifier(declaration.name)) { out.push({ name: '<pattern>', fn: false, line: lineOf(source, declaration) }); continue; }
    const initializer = declaration.initializer;
    out.push({ name: declaration.name.text, fn: Boolean(initializer && (t.isArrowFunction(initializer) || t.isFunctionExpression(initializer))), line: lineOf(source, declaration) });
  }
  return out;
}

function exportClauseNames(t: Parsed, node: Parsed, source: Parsed) {
  if (!node.exportClause) return [{ name: '*', fn: false, line: lineOf(source, node) }];
  if (t.isNamedExports(node.exportClause)) return node.exportClause.elements.map((element: Parsed) => ({ name: element.name.text, fn: false, line: lineOf(source, element), reexport: true }));
  return [{ name: node.exportClause.name.text, fn: false, line: lineOf(source, node) }];
}

function statementExports(t: Parsed, node: Parsed, source: Parsed, exported: Parsed, isDefault: Parsed) {
  if (t.isFunctionDeclaration(node) && exported(node)) return [{ name: isDefault(node) ? 'default' : node.name?.text ?? 'default', fn: true, line: lineOf(source, node) }];
  if (t.isClassDeclaration(node) && exported(node)) return [{ name: isDefault(node) ? 'default' : node.name?.text ?? 'default', fn: false, line: lineOf(source, node) }];
  if (t.isVariableStatement(node) && exported(node)) return variableExports(t, node, source);
  if (t.isExportDeclaration(node)) return exportClauseNames(t, node, source);
  if (t.isExportAssignment(node)) return [{ name: 'default', fn: false, line: lineOf(source, node) }];
  return [];
}

/** The names a parsed module exports, each with whether it is a function (declaration or an arrow/function initializer). */
export function exportedNames(source: Parsed) {
  const t = ts();
  const out = [];
  const exported = (node: Parsed) => (t.canHaveModifiers?.(node) ? t.getModifiers(node) : node.modifiers)?.some((m: Parsed) => m.kind === t.SyntaxKind.ExportKeyword);
  const isDefault = (node: Parsed) => (t.canHaveModifiers?.(node) ? t.getModifiers(node) : node.modifiers)?.some((m: Parsed) => m.kind === t.SyntaxKind.DefaultKeyword);
  for (const node of source.statements) out.push(...statementExports(t, node, source, exported, isDefault));
  return out;
}
