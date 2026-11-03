import path from 'node:path';
import { declarationOf, exportedSymbol, moduleFile, nameAnonymousParts, namesInScope, relativeSpecifier, type NamingContext } from './explicit-surface-names.mjs';
import type * as TsTypes from 'typescript';

/** An import the written type needs: `name` exported by the module `specifier`. */
export interface ImportNeed { name: string; specifier: string }
/** A type written as source text, with the imports it needs. */
export interface Rendered { ok: true; text: string; needs: ImportNeed[] }
/** Why a type is not written: a code of the report, the reason, and what a person does about it. */
export interface Refused { ok: false; code: string; reason: string; suggestion: string }

/** The longest type the codemod writes on one line; a longer one is a type a person names. */
export const MAX_TYPE_LENGTH = 100;

const refuse = (code: string, reason: string, suggestion: string): Refused => ({ ok: false, code, reason, suggestion });
const posix = (file: string): string => file.replaceAll('\\', '/');
const ABSOLUTE = /^(?:[A-Za-z]:)?\//;
const JSX_ELEMENT = new Set(['JSX.Element', 'React.JSX.Element']);

/** The text of an entity name (`A.B.C`). */
function entityText(ts: typeof import('typescript'), name: TsTypes.EntityName): string {
  return ts.isIdentifier(name) ? name.text : `${entityText(ts, name.left)}.${name.right.text}`;
}

/** The leftmost identifier of an entity name. */
function rootIdentifier(ts: typeof import('typescript'), name: TsTypes.EntityName): TsTypes.Identifier {
  return ts.isIdentifier(name) ? name : rootIdentifier(ts, name.left);
}

/** The package specifier of a file under `node_modules` (`@types/react` is `react`, `@types/a__b` is `@a/b`), and the path inside it. */
function packageOf(file: string): { name: string; inner: string } | undefined {
  const at = file.lastIndexOf('/node_modules/');
  if (at < 0) return undefined;
  const parts = file.slice(at + '/node_modules/'.length).split('/');
  const scoped = parts[0]?.startsWith('@') === true;
  let name = parts.slice(0, scoped ? 2 : 1).join('/');
  const typed = /^@types\/(.+)$/.exec(name);
  if (typed?.[1] !== undefined) name = typed[1].includes('__') ? `@${typed[1].replace('__', '/')}` : typed[1];
  return { name, inner: parts.slice(scoped ? 2 : 1).join('/').replace(/\.(?:d\.)?[cm]?tsx?$/, '').replace(/\/?index$/, '') };
}

/** The specifiers an import of `target` from `c.file` can be written with, best first: a package name, a path alias the file already uses, a relative path. */
function specifierCandidates(c: NamingContext, target: TsTypes.SourceFile): string[] {
  const installed = packageOf(posix(target.fileName));
  if (installed !== undefined) return [installed.name, ...(installed.inner ? [`${installed.name}/${installed.inner}`] : [])];
  const relative = relativeSpecifier(c.file, target.fileName);
  const nodeNext = c.options.moduleResolution === c.ts.ModuleResolutionKind.NodeNext || c.options.moduleResolution === c.ts.ModuleResolutionKind.Node16;
  const extension = /\.([cm]?)tsx?$/.exec(target.fileName);
  const written = nodeNext ? `${relative}.${extension?.[1] === 'm' ? 'mjs' : extension?.[1] === 'c' ? 'cjs' : 'js'}` : relative;
  const aliases: string[] = [];
  const base = c.options.baseUrl ?? (c.options['pathsBasePath'] as string | undefined) ?? path.dirname(c.file);
  const bare = posix(target.fileName).replace(/\.(?:d\.)?[cm]?tsx?$/, '');
  for (const [pattern, targets] of Object.entries(c.options.paths ?? {})) {
    for (const to of targets) {
      const [head = '', tail = ''] = to.split('*');
      const prefix = posix(path.resolve(base, head)) + (head.endsWith('/') ? '/' : '');
      if (to.includes('*') && bare.startsWith(prefix) && bare.endsWith(tail)) aliases.push(pattern.replace('*', bare.slice(prefix.length, bare.length - tail.length)));
      else if (!to.includes('*') && bare === posix(path.resolve(base, to)).replace(/\.(?:d\.)?[cm]?tsx?$/, '')) aliases.push(pattern);
    }
  }
  const usesAlias = c.source.statements.some(statement => c.ts.isImportDeclaration(statement) && c.ts.isStringLiteral(statement.moduleSpecifier)
    && Object.keys(c.options.paths ?? {}).some(pattern => statement.moduleSpecifier.getText(c.source).slice(1, -1).startsWith(pattern.replace('*', ''))));
  return usesAlias ? [...aliases, written] : [written, ...aliases];
}

/** Whether `specifier`, written in `c.file`, reaches the same declaration of `name` that `target` holds. */
function reaches(c: NamingContext, specifier: string, name: string, target: TsTypes.Symbol): boolean {
  const resolved = c.ts.resolveModuleName(specifier, c.file, c.options, c.ts.sys).resolvedModule?.resolvedFileName;
  const file = resolved === undefined ? undefined : c.program.getSourceFile(posix(resolved));
  return file !== undefined && exportedSymbol(c, file, name) === target;
}

/** The module file a raw specifier of the checker's import type names: an absolute path without extension, or a module name. */
function targetModule(c: NamingContext, raw: string): TsTypes.SourceFile | undefined {
  if (ABSOLUTE.test(raw)) return moduleFile(c, raw);
  const resolved = c.ts.resolveModuleName(raw, c.file, c.options, c.ts.sys).resolvedModule?.resolvedFileName;
  return resolved === undefined ? undefined : c.program.getSourceFile(posix(resolved));
}

/**
 * How `name`, exported by the module the checker named with `raw`, is written in the file: an import specifier to add, `null` when the file already has the
 * name bound to that very declaration, or a refusal when the name is taken by something else or no specifier of the file reaches it.
 */
function resolveNeed(c: NamingContext, scope: Map<string, TsTypes.Symbol>, name: string, raw: string): { specifier: string | null } | Refused {
  const file = targetModule(c, raw);
  const target = file === undefined ? undefined : exportedSymbol(c, file, name);
  if (file === undefined || target === undefined) return refuse('TYPE_UNNAMEABLE', `\`${name}\` is not exported by a module the file can import`, `export ${name} from its module, or declare a named type in this file`);
  const taken = scope.get(name);
  if (taken !== undefined) {
    if (declarationOf(c, taken) === declarationOf(c, target)) return { specifier: null };
    const global = taken.declarations?.every(declaration => !c.ts.isExternalModule(declaration.getSourceFile())) === true;
    if (!global || new RegExp(`\\b${name}\\b`).test(c.text)) return refuse('TYPE_UNNAMEABLE', `\`${name}\` is already another name in this file`, `rename one of the two, or declare a named type in this file`);
  }
  const specifier = specifierCandidates(c, file).find(candidate => reaches(c, candidate, name, target));
  return specifier === undefined ? refuse('TYPE_UNNAMEABLE', `no import path of this file reaches \`${name}\` (${posix(file.fileName)})`, `export ${name} from a module this file can import, or declare a named type in this file`) : { specifier };
}

/** Writes the checker's type node as source: import types become names plus imports, `JSX.Element` becomes `ReactElement`, and anonymous, `any` and non-nameable parts are refused. */
function rewrite(c: NamingContext, node: TsTypes.TypeNode, scope: Map<string, TsTypes.Symbol>, needs: ImportNeed[]): { node: TsTypes.TypeNode } | Refused {
  const { ts } = c;
  let refused: Refused | undefined;
  const need = (name: string, raw: string): void => {
    const resolved = resolveNeed(c, scope, name, raw);
    if ('ok' in resolved) refused ??= resolved;
    else if (resolved.specifier !== null && !needs.some(entry => entry.name === name && entry.specifier === resolved.specifier)) needs.push({ name, specifier: resolved.specifier });
  };
  // The checker names a type by an identifier that carries its symbol: a name the file cannot write is imported from the module that exports it.
  const named = (id: TsTypes.Identifier): void => {
    const symbol = (id as { symbol?: TsTypes.Symbol }).symbol;
    if (symbol === undefined) return;
    if ((symbol.flags & ts.SymbolFlags.TypeParameter) !== 0) return;
    const taken = scope.get(id.text);
    if (taken !== undefined && declarationOf(c, taken) === declarationOf(c, symbol)) return;
    const file = symbol.declarations?.[0]?.getSourceFile();
    if (file !== undefined && ts.isExternalModule(file)) need(id.text, file.fileName);
  };
  const result = ts.transform(node, [context => root => {
    const visit = (child: TsTypes.Node): TsTypes.Node => {
      if (ts.isImportTypeNode(child)) {
        const literal = ts.isLiteralTypeNode(child.argument) && ts.isStringLiteral(child.argument.literal) ? child.argument.literal.text : undefined;
        if (child.isTypeOf || child.qualifier === undefined || literal === undefined) { refused ??= refuse('TYPE_UNNAMEABLE', 'the type is a module or a `typeof import(...)`', 'declare a named type and annotate with it'); return child; }
        const args = child.typeArguments?.map(argument => visit(argument) as TsTypes.TypeNode);
        if (JSX_ELEMENT.has(entityText(ts, child.qualifier))) { need('ReactElement', 'react'); return context.factory.createTypeReferenceNode('ReactElement'); }
        need(rootIdentifier(ts, child.qualifier).text, literal);
        return context.factory.createTypeReferenceNode(child.qualifier, args);
      }
      if (ts.isTypeReferenceNode(child) && JSX_ELEMENT.has(entityText(ts, child.typeName))) { need('ReactElement', 'react'); return context.factory.createTypeReferenceNode('ReactElement'); }
      if (ts.isTypeReferenceNode(child)) named(rootIdentifier(ts, child.typeName));
      if (ts.isTypeQueryNode(child)) named(rootIdentifier(ts, child.exprName));
      if (child.kind === ts.SyntaxKind.AnyKeyword) { refused ??= refuse('TYPE_ANY', 'the inferred type contains `any`', 'write the type the value really has; an `any` on a surface hides the contract'); return child; }
      if (ts.isTypeLiteralNode(child) && child.members.length > 0) { refused ??= refuse('TYPE_ANONYMOUS', 'the inferred type is an anonymous object type', 'declare a named type (`type X = ...`), export it and annotate with it'); return child; }
      if (ts.isMappedTypeNode(child) || ts.isConditionalTypeNode(child) || (ts.isTypeOperatorNode(child) && child.operator === ts.SyntaxKind.UniqueKeyword)) {
        refused ??= refuse('TYPE_ANONYMOUS', 'the inferred type is computed (mapped, conditional or `unique symbol`)', 'declare a named type for it and annotate with it');
        return child;
      }
      return ts.visitEachChild(child, visit, context);
    };
    return visit(root) as TsTypes.TypeNode;
  }]);
  return refused ?? { node: result.transformed[0] as TsTypes.TypeNode };
}

/** The Next.js export conventions whose type the framework names: the export, its type in `next`, and whether it is a function. */
const CONVENTIONS: ReadonlyMap<string, { type: string; kind: 'function' | 'variable' }> = new Map([
  ['generateMetadata', { type: 'Metadata', kind: 'function' }], ['metadata', { type: 'Metadata', kind: 'variable' }],
  ['generateViewport', { type: 'Viewport', kind: 'function' }], ['viewport', { type: 'Viewport', kind: 'variable' }],
]);

/**
 * The type Next.js names for a route export (`generateMetadata`: `Promise<Metadata>`, `metadata`: `Metadata`, and the viewport pair), when `next` is installed and the inferred
 * type is assignable to it; undefined for any other export, so the inferred type is written instead.
 */
export function conventionType(c: NamingContext, name: string, inferred: TsTypes.Type, enclosing: TsTypes.Node, kind: 'function' | 'variable'): Rendered | undefined {
  const row = CONVENTIONS.get(name);
  const file = row?.kind === kind ? targetModule(c, 'next') : undefined;
  const symbol = row === undefined || file === undefined ? undefined : exportedSymbol(c, file, row.type);
  if (row === undefined || symbol === undefined) return undefined;
  const awaited = kind === 'function' ? c.checker.getAwaitedType(inferred) : inferred;
  if (awaited === undefined || !c.checker.isTypeAssignableTo(awaited, c.checker.getDeclaredTypeOfSymbol(symbol))) return undefined;
  const resolved = resolveNeed(c, namesInScope(c, enclosing), row.type, 'next');
  if ('ok' in resolved) return undefined;
  const written = awaited === inferred ? row.type : `Promise<${row.type}>`;
  return { ok: true, text: written, needs: resolved.specifier === null ? [] : [{ name: row.type, specifier: resolved.specifier }] };
}

/** Writes `type`, as it is seen from `enclosing`, as source text: named types by name, the imports they need, or the reason it is left to a person. */
export function renderType(c: NamingContext, type: TsTypes.Type, enclosing: TsTypes.Node, maxLength = MAX_TYPE_LENGTH): Rendered | Refused {
  const { ts } = c;
  if ((type.flags & ts.TypeFlags.Any) !== 0) return refuse('TYPE_ANY', 'the inferred type is `any`', 'write the type the value really has; an `any` on a surface hides the contract');
  const flags = ts.NodeBuilderFlags.NoTruncation;
  const drawn = c.checker.typeToTypeNode(type, enclosing, flags | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope) ?? c.checker.typeToTypeNode(type, enclosing, flags);
  if (drawn === undefined) return refuse('TYPE_UNNAMEABLE', 'the compiler cannot write the type', 'declare a named type and annotate with it');
  const needs: ImportNeed[] = [];
  const rewritten = rewrite(c, nameAnonymousParts(c, drawn, type, enclosing), namesInScope(c, enclosing), needs);
  if ('ok' in rewritten) return rewritten;
  const text = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, rewritten.node, c.source);
  if (text.length > maxLength) return refuse('TYPE_TOO_LONG', `the type is ${text.length} characters (${text.slice(0, 60)}...)`, 'declare a named type (`type X = ...`), export it and annotate with it');
  return { ok: true, text, needs };
}
