import type { ImportNeed } from './explicit-surface-render.mjs';
import type * as TsTypes from 'typescript';

type Ts = typeof import('typescript');

/** One text edit of the source: the span `start`..`end` becomes `text`. */
export interface Edit { start: number; end: number; text: string }

/** The edits that give a file the imports `needs` names: a specifier added to a named import of the same module, else one `import type` line per module. */
export function importEdits(ts: Ts, source: TsTypes.SourceFile, text: string, needs: readonly ImportNeed[]): Edit[] {
  if (!needs.length) return [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const imports = source.statements.filter(ts.isImportDeclaration);
  const first = imports[0];
  const quote = first !== undefined && ts.isStringLiteral(first.moduleSpecifier) ? first.moduleSpecifier.getText(source).slice(0, 1) : '"';
  const semicolon = first !== undefined && first.getText(source).endsWith(';') ? ';' : '';
  const edits: Edit[] = [];
  const lines: string[] = [];
  const bySpecifier = new Map<string, string[]>();
  for (const need of needs) bySpecifier.set(need.specifier, [...(bySpecifier.get(need.specifier) ?? []), need.name]);
  for (const [specifier, names] of bySpecifier) {
    const sorted = [...new Set(names)].sort();
    const home = imports.find(declaration => ts.isStringLiteral(declaration.moduleSpecifier) && declaration.moduleSpecifier.text === specifier
      && declaration.importClause?.namedBindings !== undefined && ts.isNamedImports(declaration.importClause.namedBindings) && declaration.importClause.namedBindings.elements.length > 0);
    const clause = home?.importClause;
    const bindings = clause?.namedBindings;
    if (clause !== undefined && bindings !== undefined && ts.isNamedImports(bindings)) {
      const last = bindings.elements[bindings.elements.length - 1] as TsTypes.ImportSpecifier;
      edits.push({ start: last.end, end: last.end, text: sorted.map(name => `, ${clause.isTypeOnly ? '' : 'type '}${name}`).join('') });
    } else lines.push(`import type { ${sorted.join(', ')} } from ${quote}${specifier}${quote}${semicolon}`);
  }
  if (lines.length) edits.push(newImports(ts, source, text, lines, eol));
  return edits;
}

/** The edit that adds whole import lines: after the last import, else after the directive prologue, else above the first statement. */
function newImports(ts: Ts, source: TsTypes.SourceFile, text: string, lines: readonly string[], eol: string): Edit {
  const block = lines.join(eol);
  const last = source.statements.filter(ts.isImportDeclaration).at(-1);
  if (last !== undefined) return { start: last.end, end: last.end, text: `${eol}${block}` };
  let prologue: TsTypes.Statement | undefined;
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    prologue = statement;
  }
  if (prologue !== undefined) return { start: prologue.end, end: prologue.end, text: `${eol}${eol}${block}` };
  const first = source.statements[0];
  const at = first === undefined ? text.length : first.getStart(source);
  return { start: at, end: at, text: `${block}${eol}${eol}` };
}

/** `text` with `edits` applied, last position first so every offset stays true; edits at one position keep their order. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  const ordered = edits.map((edit, at) => ({ edit, at })).sort((a, b) => b.edit.start - a.edit.start || b.edit.end - a.edit.end || b.at - a.at);
  let output = text;
  for (const { edit } of ordered) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
