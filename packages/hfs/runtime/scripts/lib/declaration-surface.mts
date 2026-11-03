// declaration-surface.mjs — the one classifier of a TypeScript file's exported type surface: the isolated declaration emit
// (`ts.transpileDeclaration`, TypeScript 5.5 and later, which reads the file alone) and the exports it cannot write without inference.
//
// Two readers share it and cannot drift: the ESLint result cache (hfs cache/import-graph.mjs: a file with a problem is `open`, its importers are
// linted again whenever it changes) and the `explicit-export-surface` rule of both lint canons (scripts/hfs/explicit-surface-rule.mjs, which reports
// each problem with what to annotate). A component that returns only JSX has the type the JSX namespace gives it, whatever its body reads, so it
// is not a problem. `ts` is the caller's compiler (the app's own install); nothing here resolves a package.
import type { Diagnostic, Expression, FunctionLikeDeclaration, Node, SourceFile } from 'typescript';
import type { TypeScript } from './ts-ast.mjs';

/** What the declaration emit cannot write without reading other files, and where: one export (or one part of it) the author must annotate. */
export interface SurfaceProblem {
  /** The TypeScript diagnostic code (9007: function without a return type, 9010: variable without a type, ...). */
  code: number;
  /** The offset and length of the offending span in the file's text. */
  start: number;
  length: number;
  /** The name of the export (or member) the span sits in, or `default export`. */
  name: string;
  /** What to annotate: `return type`, `variable type`, `parameter type`, `property type`, `accessor type` or `exported value`. */
  annotate: string;
  /** TypeScript's own reason, one sentence. */
  reason: string;
}

/** The declaration emit of one file: its text (the digest of the type surface) and the exports it could not write explicitly. */
export interface DeclarationSurface {
  outputText: string;
  problems: SurfaceProblem[];
}

/** A script file (`.js`, `.mjs`, `.cjs`, `.jsx`): it has no declaration emit and stands for its content. */
export const SCRIPT = /\.(?:[cm]?jsx?)$/;
/** A declaration file: it is its own surface. */
export const DECLARATION = /\.d\.[cm]?ts$/;
/** A TypeScript source file whose surface the declaration emit writes. */
export const TYPESCRIPT = /\.(?:[cm]?tsx?)$/;

/** Whether `file` is a TypeScript source (not a declaration file) the declaration emit reads. */
export const isEmittableSource = (file: string): boolean => TYPESCRIPT.test(file) && !DECLARATION.test(file);

/** Whether `expression` is a JSX element, fragment, `null` or `undefined`, or a conditional of those: its type does not depend on any other file. */
function isJsxValue(ts: TypeScript, expression: Expression | undefined): boolean {
  if (expression === undefined) return false;
  let node: Expression = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(node)) return node.text === 'undefined';
  return ts.isConditionalExpression(node) && isJsxValue(ts, node.whenTrue) && isJsxValue(ts, node.whenFalse);
}

/**
 * Whether the function (or method) the declaration diagnostic at `start` points at has the type `JSX.Element | null | undefined` whatever its body
 * reads: not async, not a generator, and every `return` of its own (and its concise body) a JSX value. A React component written without a return
 * type is the common case; its inferred type is one the JSX namespace of the installed packages gives, which a lockfile change dirties as a whole.
 */
function returnsOnlyJsx(ts: TypeScript, source: SourceFile, start: number): boolean {
  let found: FunctionLikeDeclaration | undefined;
  const find = (node: Node): void => {
    if (found !== undefined || start < node.getFullStart() || start >= node.end) return;
    const named = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined && node.name.getStart(source) === start;
    if (named || ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.getStart(source) === start)) { found = node as FunctionLikeDeclaration; return; }
    ts.forEachChild(node, find);
  };
  find(source);
  const fn = found as FunctionLikeDeclaration | undefined;
  if (fn === undefined || fn.type !== undefined || fn.body === undefined) return false;
  if (fn.asteriskToken !== undefined || (ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) !== 0) return false;
  if (!ts.isBlock(fn.body)) return isJsxValue(ts, fn.body);
  let only = true;
  const visit = (node: Node): void => {
    if (!only || ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined && !isJsxValue(ts, node.expression)) only = false;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return only;
}

/** What to annotate for each isolated-declaration diagnostic code; any other code asks for the exported value's type. */
const ANNOTATE = new Map<number, string>([
  [9007, 'return type'], [9008, 'return type'], [9009, 'accessor type'], [9010, 'variable type'], [9011, 'parameter type'], [9012, 'property type'],
  [9025, 'parameter type'],
]);

/** The declaration kinds whose name labels the export a diagnostic sits in, innermost first. */
function nameOf(ts: TypeScript, source: SourceFile, start: number): string {
  let innermost: Node = source;
  const descend = (node: Node): void => {
    if (start < node.getFullStart() || start >= node.end) return;
    innermost = node;
    ts.forEachChild(node, descend);
  };
  ts.forEachChild(source, descend);
  for (let node: Node | undefined = innermost; node !== undefined && node !== source; node = node.parent) {
    if (ts.isExportAssignment(node)) return 'default export';
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node) || ts.isGetAccessorDeclaration(node)) && node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text;
    if (ts.isFunctionDeclaration(node) && (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0) return 'default export';
  }
  return 'default export';
}

/**
 * The declaration emit of one TypeScript source and the exports it could not write explicitly (a type inferred from bodies and other files), or null
 * when the compiler has no `transpileDeclaration` (before TypeScript 5.5). A declaration whose only diagnostics are components returning JSX has the
 * surface its emit shows. `module` is the side's `module` compiler option, which the emit reads. A throw from the compiler propagates: the caller
 * decides what an unreadable file means.
 */
export function declarationSurface(ts: TypeScript, file: string, text: string, module?: number): DeclarationSurface | null {
  const emit = (ts as { transpileDeclaration?: (input: string, options: { compilerOptions?: object; fileName?: string; reportDiagnostics?: boolean }) => { outputText: string; diagnostics?: readonly unknown[] } }).transpileDeclaration;
  if (emit === undefined) return null;
  const declared = emit.call(ts, text, { compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest, ...(module === undefined ? {} : { module }) }, fileName: file, reportDiagnostics: true });
  const diagnostics = (declared.diagnostics ?? []) as readonly Diagnostic[];
  if (diagnostics.length === 0) return { outputText: declared.outputText, problems: [] };
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const problems: SurfaceProblem[] = [];
  for (const diagnostic of diagnostics) {
    const exempt = (diagnostic.code === 9007 || diagnostic.code === 9008) && diagnostic.start !== undefined && returnsOnlyJsx(ts, source, diagnostic.start);
    if (exempt) continue;
    const start = diagnostic.start ?? 0;
    problems.push({
      code: diagnostic.code, start, length: diagnostic.length ?? 0, name: nameOf(ts, source, start), annotate: ANNOTATE.get(diagnostic.code) ?? 'exported value',
      reason: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')[0] ?? '',
    });
  }
  return { outputText: declared.outputText, problems };
}
