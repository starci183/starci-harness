import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { sourceLocation } from '../runtime/scripts/lib/ts-ast.mjs';
import type * as TsTypes from 'typescript';

/** The TypeScript compiler API of the app's own install (loadTypescript), typed by the version this package develops against. */
type Ts = typeof import('typescript');
type SourceFile = TsTypes.SourceFile;

/** One rewrite of the report: a layout element whose classes were only a flex column or row and its gap. */
export interface SpacingChange { file: string; line: number; column: number; from: string; to: string; review?: string }
/** One spacing utility the codemod leaves for a person, with the role it suggests when it has one. */
export interface SpacingFinding { file: string; line: number; column: number; code: string; utility: string; suggestion: string; reason: string }
/** The report of a migration (`starci app codemod spacing-roles`). */
export interface SpacingReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[];
  /** Every spacing utility of the scanned source by family (gap, padding, margin, space), before the rewrite. */
  counts: Record<string, number>;
  changes: SpacingChange[]; findings: SpacingFinding[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = /^@starci\/grammar(?:\/(?:core|common|offset-pop))?$/;
const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);
const SPACING_UTILITY = /^-?(p|px|py|pt|pb|ps|pe|pl|pr|m|mx|my|mt|mb|ms|me|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(.+)$/;

/** The role each Tailwind gap step names (the doctrine's mapping); `review` marks a step whose role a person confirms. */
export const GAP_ROLES: Readonly<Record<string, { role: string; review?: string }>> = Object.freeze({
  '1': { role: 'identity' },
  '2': { role: 'inline' },
  '3': { role: 'row' },
  '4': { role: 'section' },
  '6': { role: 'region' },
  '8': { role: 'region', review: 'gap-8 and gap-6 both become region; confirm the two blocks are page regions with their own heading' },
});

/** Classes a Stack or Cluster already draws, so an element holding only these and one gap becomes the primitive. */
const STACK_CLASSES = new Set(['flex', 'flex-col', 'min-w-0']);
const CLUSTER_CLASSES = new Set(['flex', 'flex-row', 'flex-wrap', 'items-center', 'min-w-0']);

const family = (utility: string): string => {
  const name = SPACING_UTILITY.exec(utility.replace(/^!|!$/g, ''))?.[1] ?? '';
  return name.startsWith('gap') ? 'gap' : name.startsWith('space') ? 'space' : name.startsWith('p') ? 'padding' : 'margin';
};

/** The utility once its variants are dropped (`sm:gap-2` is `gap-2`); a variant marks a responsive or state choice. */
const baseOf = (cls: string): string => cls.slice(cls.lastIndexOf(':') + 1);

/** The spacing utilities of one class string. */
export const spacingUtilities = (text: string): string[] => text.split(/\s+/).filter((cls) => SPACING_UTILITY.test(baseOf(cls).replace(/^!|!$/g, '')));

/** What a person writes instead of one utility the codemod does not rewrite. */
const suggestionFor = (utility: string): string => {
  const base = baseOf(utility);
  const kind = family(base);
  if (kind === 'gap' || kind === 'space') {
    const step = /-(\d+)$/.exec(base)?.[1] ?? '';
    const mapped = GAP_ROLES[step];
    return mapped ? `gap="${mapped.role}" on a Stack or Cluster` : 'the role of the relation on a Stack, Cluster or Grid';
  }
  return kind === 'margin' ? "the parent's gap role" : 'the inset of the Grammar box that holds the content';
};

/** The Grammar import that binds Stack and Cluster in a file: the family specifier it already imports. */
function grammarImport(ts: Ts, source: SourceFile): { specifier: string; node: TsTypes.ImportDeclaration; names: Set<string> } | null {
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !GRAMMAR.test(node.moduleSpecifier.text)) continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings) || node.importClause?.isTypeOnly) continue;
    return { specifier: node.moduleSpecifier.text, node, names: new Set(bindings.elements.map((element) => element.name.text)) };
  }
  return null;
}

/** The static class string of an element, or null when it is computed. */
function classText(ts: Ts, attribute: TsTypes.JsxAttribute | undefined): string | null {
  const value = attribute?.initializer;
  if (value === undefined) return null;
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isJsxExpression(value) && value.expression !== undefined && ts.isStringLiteralLike(value.expression)) return value.expression.text;
  return null;
}

/** The primitive and its props an element's classes ask for, or why it stays for a person. */
function primitiveFor(classes: readonly string[]): { tag: string; props: string; review?: string } | { reason: string } {
  const gaps = classes.filter((cls) => /^gap-\d+$/.test(cls));
  if (gaps.length !== 1) return { reason: 'the element holds no single plain gap utility' };
  const step = (gaps[0] ?? '').slice(4);
  const mapped = GAP_ROLES[step];
  if (mapped === undefined) return { reason: `gap-${step} names no role; choose the relation` };
  const rest = classes.filter((cls) => cls !== gaps[0]);
  const review = mapped.review === undefined ? {} : { review: mapped.review };
  if (rest.includes('flex-col') && rest.every((cls) => STACK_CLASSES.has(cls))) return { tag: 'Stack', props: `gap="${mapped.role}"`, ...review };
  if (rest.includes('flex') && !rest.includes('flex-col') && rest.every((cls) => CLUSTER_CLASSES.has(cls))) {
    if (mapped.role === 'region') return { reason: 'a cluster never holds regions; a region gap belongs to a Stack or a Grid' };
    return { tag: 'Cluster', props: `gap="${mapped.role}"${rest.includes('flex-wrap') ? '' : ' wrap={false}'}`, ...review };
  }
  return { reason: 'the element carries layout classes a Stack or Cluster does not draw; move them to a Grammar API first' };
}

/** Rewrite one source text: plain `div` flex columns and rows whose only spacing is one gap become Stack and Cluster. */
export function transformSpacingRoles({ ts, text, file = 'component.tsx' }: { ts: Ts; text: string; file?: string }): { text: string; changes: SpacingChange[]; findings: SpacingFinding[]; counts: Record<string, number> } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);
  const changes: SpacingChange[] = [];
  const findings: SpacingFinding[] = [];
  const counts: Record<string, number> = {};
  const edits: { start: number; end: number; replacement: string }[] = [];
  const needed = new Set<string>();
  const imported = grammarImport(ts, source);
  const leave = (node: TsTypes.Node, utility: string, code: string, reason: string): void => {
    findings.push({ file, ...sourceLocation(source, node), code, utility, suggestion: suggestionFor(utility), reason });
  };
  const visitString = (node: TsTypes.StringLiteralLike): void => {
    for (const utility of spacingUtilities(node.text)) {
      counts[family(baseOf(utility))] = (counts[family(baseOf(utility))] ?? 0) + 1;
      leave(node, utility, 'class-string', 'a class string outside a plain layout element; name the relation where it is used');
    }
  };
  const visitElement = (opening: TsTypes.JsxOpeningElement | TsTypes.JsxSelfClosingElement, element: TsTypes.JsxElement | TsTypes.JsxSelfClosingElement): void => {
    const attributes = opening.attributes.properties;
    const classAttribute = attributes.find((entry): entry is TsTypes.JsxAttribute => ts.isJsxAttribute(entry) && entry.name.getText(source) === 'className');
    const text = classText(ts, classAttribute);
    if (text === null) return;
    const utilities = spacingUtilities(text);
    for (const utility of utilities) counts[family(baseOf(utility))] = (counts[family(baseOf(utility))] ?? 0) + 1;
    if (utilities.length === 0) return;
    const classes = text.split(/\s+/).filter(Boolean);
    const others = attributes.filter((entry) => entry !== classAttribute && !(ts.isJsxAttribute(entry) && entry.name.getText(source) === 'key'));
    const isDiv = opening.tagName.getText(source) === 'div';
    const target = primitiveFor(classes);
    const reason = !isDiv ? 'only a plain div becomes a layout primitive' : others.length > 0 ? 'the element carries props a layout primitive does not take' : imported === null ? 'the file imports no Grammar family to bind the primitive from' : 'reason' in target ? target.reason : null;
    if (reason !== null || 'reason' in target) {
      for (const utility of utilities) leave(opening, utility, 'layout-element', reason ?? 'the element stays for a person');
      return;
    }
    needed.add(target.tag);
    const key = attributes.find((entry) => ts.isJsxAttribute(entry) && entry.name.getText(source) === 'key');
    const props = `${target.tag} ${target.props}${key === undefined ? '' : ` ${key.getText(source)}`}`;
    edits.push({ start: opening.getStart(source), end: opening.end, replacement: ts.isJsxSelfClosingElement(opening) ? `<${props} />` : `<${props}>` });
    if (ts.isJsxElement(element)) edits.push({ start: element.closingElement.getStart(source), end: element.closingElement.end, replacement: `</${target.tag}>` });
    changes.push({ file, ...sourceLocation(source, opening), from: text, to: `<${target.tag} ${target.props}>`, ...(target.review === undefined ? {} : { review: target.review }) });
  };
  const visit = (node: TsTypes.Node): void => {
    if (ts.isJsxElement(node)) visitElement(node.openingElement, node);
    else if (ts.isJsxSelfClosingElement(node)) visitElement(node, node);
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isJsxAttribute(node.parent) && !ts.isImportDeclaration(node.parent) && !(ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent))) visitString(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (imported !== null) {
    const missing = [...needed].filter((name) => !imported.names.has(name)).sort();
    const bindings = imported.node.importClause?.namedBindings;
    if (missing.length > 0 && bindings !== undefined && ts.isNamedImports(bindings)) {
      const names = [...bindings.elements.map((element) => element.getText(source)), ...missing];
      edits.push({ start: bindings.getStart(source), end: bindings.end, replacement: `{ ${names.join(', ')} }` });
    }
  }
  let output = text;
  for (const edit of edits.sort((first, second) => second.start - first.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  return { text: output, changes, findings, counts };
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : sourceFiles(target);
    return entry.isFile() && /\.[jt]sx?$/i.test(entry.name) && !/\.(?:spec|test|d)\.[jt]sx?$/i.test(entry.name) ? [target] : [];
  }).sort();
}

/** Preview or apply the safe rewrites in one app's FE tree; every utility left is in the report with its suggested role. */
export function migrateSpacingRoles({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; write?: boolean; ts?: Ts | null }): SpacingReport {
  if (!ts) throw new Error('spacing-roles needs TypeScript installed in the app or @starci/hfs development checkout');
  const frontend = path.join(root, 'fe');
  if (!fs.statSync(frontend, { throwIfNoEntry: false })?.isDirectory()) throw new Error('spacing-roles runs at an app root with a fe/ directory');
  const report: SpacingReport = { schema: 'starci/spacing-roles-codemod@1', root, write, filesScanned: 0, filesChanged: [], counts: {}, changes: [], findings: [] };
  for (const target of sourceFiles(frontend)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformSpacingRoles({ ts, text: original, file });
    report.filesScanned += 1;
    report.changes.push(...result.changes);
    report.findings.push(...result.findings);
    for (const [name, count] of Object.entries(result.counts)) report.counts[name] = (report.counts[name] ?? 0) + count;
    if (result.text !== original) {
      report.filesChanged.push(file);
      if (write) fs.writeFileSync(target, result.text);
    }
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and the utilities left for a person as Markdown; JSON consumers read the same report object. */
export function spacingRolesMarkdown(report: SpacingReport): string {
  const counts = Object.entries(report.counts).sort().map(([name, count]) => `${name} ${count}`).join(', ') || 'none';
  return ['# Spacing roles migration', '',
    `${report.write ? 'Applied' : 'Dry run'}: ${report.changes.length} rewrites in ${report.filesChanged.length} files of ${report.filesScanned}; ${report.findings.length} utilities left for a person.`, '',
    `Spacing utilities before: ${counts}.`, '',
    '## Rewrites', '', '| Location | Classes | Becomes | Review |', '| --- | --- | --- | --- |',
    ...report.changes.map((change) => `| ${cell(`${change.file}:${change.line}:${change.column}`)} | ${cell(change.from)} | ${cell(change.to)} | ${cell(change.review ?? '')} |`), '',
    '## Left for a person', '', '| Location | Utility | Suggestion | Reason |', '| --- | --- | --- | --- |',
    ...report.findings.map((finding) => `| ${cell(`${finding.file}:${finding.line}:${finding.column}`)} | ${cell(finding.utility)} | ${cell(finding.suggestion)} | ${cell(finding.reason)} |`), ''].join('\n');
}
