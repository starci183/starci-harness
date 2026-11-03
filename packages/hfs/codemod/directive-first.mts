import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { sourceLocation } from '../runtime/scripts/lib/ts-ast.mjs';
import { filesUnder, relativePosix, sideFolders } from './source-tree.mjs';
import type * as TsTypes from 'typescript';

/** The TypeScript compiler API of the app's own install (loadTypescript), typed by the version this package develops against. */
type Ts = typeof import('typescript');

/** One move of the report: a directive taken from `line` to the top of its module. */
export interface DirectiveFirstChange { file: string; line: number; column: number; code: string; from: string; to: string }
/** One case left for a person. */
export interface DirectiveFirstFinding { file: string; line: number; column: number; code: string; reason: string }
/** The report of a migration (`starci app codemod directive-first`). */
export interface DirectiveFirstReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: DirectiveFirstChange[]; findings: DirectiveFirstFinding[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The directives Next.js reads from the prologue of a module (R369, FE_DIRECTIVE_FIRST). */
const DIRECTIVES: ReadonlySet<string> = new Set(['use client', 'use server']);
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const DECLARATION = /\.d\.[cm]?ts$/i;

/** The string literal a statement is made of, through the parentheses Prettier wraps it in, or null. */
function stringStatement(ts: Ts, statement: TsTypes.Statement): TsTypes.StringLiteral | null {
  if (!ts.isExpressionStatement(statement)) return null;
  let expression: TsTypes.Expression = statement.expression;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  return ts.isStringLiteral(expression) ? expression : null;
}

/** The span to delete for `statement`: its own line when nothing else is on it (with a `;` Prettier put before a parenthesized statement), else the statement alone. */
function removalSpan(text: string, statement: TsTypes.Statement, source: TsTypes.SourceFile): { start: number; end: number } {
  let start = statement.getStart(source);
  let end = statement.end;
  let from = start;
  while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from -= 1;
  if (text[from - 1] === ';' && (from - 1 === 0 || text[from - 2] === '\n')) from -= 1;
  const startsLine = from === 0 || text[from - 1] === '\n';
  let to = end;
  while (to < text.length && (text[to] === ' ' || text[to] === '\t')) to += 1;
  const endsLine = to >= text.length || text[to] === '\n' || text[to] === '\r';
  if (startsLine && endsLine) {
    start = from;
    end = text[to] === '\r' ? to + 2 : to + 1;
  }
  return { start, end: Math.min(end, text.length) };
}

/** Move every `"use client"` / `"use server"` that is not in the prologue of the module to the top of it, as its first statement, with one blank line after. */
export function transformDirectiveFirst({ ts, text, file = 'module.tsx' }: { ts: Ts; text: string; file?: string }): { text: string; changes: DirectiveFirstChange[]; findings: DirectiveFirstFinding[] } {
  const none = { text, changes: [], findings: [] };
  if (!text.includes('use client') && !text.includes('use server')) return none;
  const kind = /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : /\.[cm]?js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const first = source.statements[0];
  if (first === undefined) return none;
  // The prologue is the run of plain string statements at the top; a parenthesized one is an expression, not a directive.
  let prologueEnd = 0;
  const kept = new Set<string>();
  while (prologueEnd < source.statements.length) {
    const statement = source.statements[prologueEnd] as TsTypes.Statement;
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    kept.add(statement.expression.text);
    prologueEnd += 1;
  }
  const misplaced = source.statements.slice(prologueEnd).flatMap((statement, offset) => {
    const literal = stringStatement(ts, statement);
    return literal !== null && DIRECTIVES.has(literal.text) ? [{ statement, literal, before: prologueEnd + offset }] : [];
  });
  if (!misplaced.length) return none;
  const changes: DirectiveFirstChange[] = [];
  const findings: DirectiveFirstFinding[] = [];
  const opposite = (directive: string): string => (directive === 'use client' ? 'use server' : 'use client');
  const wanted = new Set(misplaced.map(entry => entry.literal.text));
  const edits: { start: number; end: number; text: string }[] = [];
  const toTop: string[] = [];
  const placed = new Set(kept);
  for (const { statement, literal, before } of misplaced) {
    const place = sourceLocation(source, statement);
    const directive = literal.text;
    if (kept.has(opposite(directive)) || wanted.has(opposite(directive))) {
      findings.push({ file, ...place, code: 'CONFLICTING_DIRECTIVES', reason: `"use client" and "use server" cannot share a module: split it, then keep the one directive that stays at the top` });
      continue;
    }
    edits.push({ ...removalSpan(text, statement, source), text: '' });
    if (!placed.has(directive)) {
      toTop.push(literal.getText(source) + (statement.getText(source).endsWith(';') ? ';' : ''));
      placed.add(directive);
    }
    const mangled = ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression);
    changes.push({ file, ...place, code: mangled ? 'DIRECTIVE_PARENTHESIZED' : 'DIRECTIVE_BELOW_STATEMENT', from: `${mangled ? 'parenthesized, ' : ''}after ${before} statement${before === 1 ? '' : 's'}`, to: 'first statement' });
  }
  if (toTop.length) edits.push({ start: first.getStart(source), end: first.getStart(source), text: `${toTop.join('\n')}\n\n` });
  let output = text;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { text: output, changes, findings };
}

/** Preview or apply the moves in one app (`be/`, `fe/`, or `src/` of a single-side app); a conflicting module is kept in the returned report. */
export function migrateDirectiveFirst({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; write?: boolean; ts?: Ts | null }): DirectiveFirstReport {
  if (!ts) throw new Error('directive-first needs TypeScript installed in the app or @starci/hfs development checkout');
  const folders = sideFolders(root);
  if (!folders.length) throw new Error('directive-first runs at an app root with a fe/ directory');
  const report: DirectiveFirstReport = { schema: 'starci/directive-first-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of folders.flatMap(folder => filesUnder(folder, SOURCE)).filter(target => !DECLARATION.test(target))) {
    const file = relativePosix(root, target);
    const original = fs.readFileSync(target, 'utf8');
    const result = transformDirectiveFirst({ ts, text: original, file });
    report.filesScanned += 1;
    report.changes.push(...result.changes);
    report.findings.push(...result.findings);
    if (result.text !== original) {
      report.filesChanged.push(file);
      if (write) fs.writeFileSync(target, result.text);
    }
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the moves and what is left for a person as Markdown; JSON consumers read the same report object. */
export function directiveFirstMarkdown(report: DirectiveFirstReport): string {
  const out = ['# directive-first', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'changed' : 'would change'}, ${report.changes.length} directives moved, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| location | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(`${finding.file}:${finding.line}:${finding.column}`)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Moves', '', '| location | code | from | to |', '|---|---|---|---|');
    for (const item of report.changes) out.push(`| ${cell(`${item.file}:${item.line}:${item.column}`)} | ${item.code} | ${cell(item.from)} | ${cell(item.to)} |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
