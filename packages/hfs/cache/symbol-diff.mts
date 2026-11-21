// symbol-diff.mts - which exported symbols of one TypeScript module changed between two texts (the base and the head), for the UI audit reach (uiaudit-family.mts): a screen
// that imports a changed module is stale only when a name it takes from it changed. A symbol's fingerprint is the token text of its declaration (comments and layout left
// out) together with the printed text of every top-level declaration of the same file it references, transitively: a helper or a constant it uses and the import binding it
// reads. Whatever cannot be told apart this way falls back to the whole file (`all: true`): a parse error, a module with `export * from`, a side-effect import (no names), a file that
// is new or gone. The fallback is always the safe side: the module counts as changed.
import { createHash } from 'node:crypto';
import type TypeScript from 'typescript';

type Ts = typeof TypeScript;

/** The exported symbols that differ between two texts, or every symbol of the file (`all`) when they cannot be compared. */
export interface SymbolDiff { all: boolean; names: ReadonlySet<string> }

/** The whole file counts as changed. */
const WHOLE: SymbolDiff = { all: true, names: new Set() };
/** A file the base did not have: only a changed file can import it, and that one counts for itself, so it adds nothing. */
const ADDED: SymbolDiff = { all: false, names: new Set() };

/** The fingerprints of a file's exported symbols, or null when the file cannot be read this way (parse error, `export *`). */
function fingerprints(ts: Ts, file: string, text: string): Map<string, string> | null {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const problems = (source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
  if (problems !== undefined && problems.length > 0) return null;
  // the tokens of a node, comments and layout left out: the same code in another shape is the same symbol
  const print = (node: TypeScript.Node): string => {
    const tokens: string[] = [];
    const walk = (child: TypeScript.Node): void => {
      if (child.kind >= ts.SyntaxKind.FirstJSDocNode && child.kind <= ts.SyntaxKind.LastJSDocNode) return;
      if (child.getChildCount(source) === 0) { if (child.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push(child.getText(source)); return; }
      for (const next of child.getChildren(source)) walk(next);
    };
    walk(node);
    return tokens.join(' ');
  };
  const hasExport = (node: TypeScript.Node): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const hasDefault = (node: TypeScript.Node): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  // the top-level names a file declares, each with the printed text that declares it (imports: the binding's own text)
  const locals = new Map<string, string>();
  const exported = new Map<string, { text: string; refs: Set<string> }>();
  const identifiersOf = (node: TypeScript.Node): Set<string> => {
    const found = new Set<string>();
    const visit = (child: TypeScript.Node): void => { if (ts.isIdentifier(child)) found.add(child.text); ts.forEachChild(child, visit); };
    visit(node);
    return found;
  };
  const declare = (name: string, node: TypeScript.Node): void => { locals.set(name, print(node)); };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const from = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
      if (clause === undefined) continue;
      if (clause.name !== undefined) locals.set(clause.name.text, `import ${clause.name.text} from ${from}`);
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) locals.set(bindings.name.text, `import * as ${bindings.name.text} from ${from}`);
      else if (bindings !== undefined) for (const element of bindings.elements) locals.set(element.name.text, `import ${(element.propertyName ?? element.name).text} as ${element.name.text} from ${from}${clause.isTypeOnly || element.isTypeOnly ? ' type' : ''}`);
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier !== undefined && statement.exportClause === undefined) return null;
      const from = statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const local = (element.propertyName ?? element.name).text;
          exported.set(element.name.text, { text: from === null ? `export ${local}` : `export ${local} from ${from}`, refs: from === null ? new Set([local]) : new Set() });
        }
      } else if (clause !== undefined && ts.isNamespaceExport(clause)) exported.set(clause.name.text, { text: `export * as ${clause.name.text} from ${from ?? ''}`, refs: new Set() });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) { if (hasExport(statement)) return null; continue; }
        const text = `${statement.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'let'} ${print(declaration)}`;
        locals.set(declaration.name.text, text);
        if (hasExport(statement)) exported.set(declaration.name.text, { text, refs: identifiersOf(declaration) });
      }
    } else if (ts.isExportAssignment(statement)) {
      exported.set('default', { text: print(statement), refs: identifiersOf(statement) });
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) {
      const name = statement.name !== undefined && ts.isIdentifier(statement.name) ? statement.name.text : null;
      const key = hasDefault(statement) ? 'default' : name;
      if (key === null) continue;
      if (name !== null) declare(name, statement);
      if (hasExport(statement)) exported.set(key, { text: print(statement), refs: identifiersOf(statement) });
    }
  }
  const result = new Map<string, string>();
  for (const [name, entry] of exported) {
    const included = new Set<string>();
    const queue = [...entry.refs];
    while (queue.length > 0) {
      const next = queue.pop() as string;
      if (included.has(next) || !locals.has(next)) continue;
      included.add(next);
    }
    // the declarations a symbol uses, found by their own references in turn
    let grew = true;
    while (grew) {
      grew = false;
      for (const local of [...included]) {
        const text = locals.get(local) as string;
        for (const word of text.split(/[^A-Za-z0-9_$]+/u)) if (word !== '' && locals.has(word) && !included.has(word)) { included.add(word); grew = true; }
      }
    }
    const context = [...included].sort().map((local) => `${local}=${locals.get(local) as string}`).join('\n');
    result.set(name, createHash('sha256').update(`${entry.text}\n--\n${context}`).digest('hex'));
  }
  return result;
}

/**
 * The exported symbols whose fingerprint differs between `base` and `head`. A symbol only in one of them counts as changed. `base` null is a file the base did not have (it adds nothing: see
 * ADDED), `head` null a file that is gone or unreadable, and a file the fingerprints cannot read counts as wholly changed.
 */
export function changedSymbols(ts: Ts, file: string, base: string | null, head: string | null): SymbolDiff {
  if (head === null || !/\.[cm]?[jt]sx?$/u.test(file)) return WHOLE;
  if (base === null) return ADDED;
  try {
    const before = fingerprints(ts, file, base);
    const after = fingerprints(ts, file, head);
    if (before === null || after === null) return WHOLE;
    const names = new Set<string>();
    for (const [name, print] of after) if (before.get(name) !== print) names.add(name);
    for (const name of before.keys()) if (!after.has(name)) names.add(name);
    return { all: false, names };
  } catch { return WHOLE; }
}
