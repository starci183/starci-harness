import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { sourceLocation } from '../runtime/scripts/lib/ts-ast.mjs';
import { shadowed } from './small-renames.mjs';
import type * as TsTypes from 'typescript';

/** The TypeScript compiler API of the app's own install (loadTypescript), typed by the version this package develops against. */
type Ts = typeof import('typescript');
type Node = TsTypes.Node;
type Element = TsTypes.JsxElement | TsTypes.JsxSelfClosingElement;

/** One text edit of the source. */
interface Edit { start: number; end: number; text: string }
/** One safe rewrite of the report. */
export interface TierBindingChange { file: string; line: number; column: number; code: string; from: string; to: string }
/** One case left for a person. */
export interface TierBindingFinding { file: string; line: number; column: number; code: string; reason: string; component?: string; source?: string }
/** The report of a migration (`starci app codemod tier-binding`). */
export interface TierBindingReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: TierBindingChange[]; findings: TierBindingFinding[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = /^@starci\/grammar(?:\/|$)/;
const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);

/** Components whose child became a named prop: the JSX child moves into it. `text` takes a string, the rest a node. */
const CHILD_TO_PROP: ReadonlyMap<string, { prop: string; text?: boolean }> = new Map([
  ['Tooltip', { prop: 'trigger' }], ['Disclosure', { prop: 'body' }], ['DragItem', { prop: 'body' }], ['MessageBubble', { prop: 'body' }],
  ['MediaFrame', { prop: 'media' }], ['Field', { prop: 'control' }], ['Quote', { prop: 'text', text: true }],
]);
/** Leaves whose only child is their text label (`LabelChild`). */
const LABEL_ONLY = new Set(['Button', 'Badge', 'Heading', 'Link', 'TextAction', 'Code']);
/** Components that take no children at all (`NoChildren`): their anatomy is fields and named slots. */
const NO_CHILDREN = new Set([
  'Avatar', 'AvatarButton', 'Checkbox', 'DateField', 'Divider', 'Icon', 'IconButton', 'IconTile', 'Image', 'Kbd', 'Mascot', 'Meter', 'NumberField', 'PressableField',
  'Progress', 'ProgressCircle', 'RelativeTime', 'SearchField', 'Skeleton', 'Slider', 'Spinner', 'StatusDot', 'Switch', 'TimeField', 'Video',
  'Accordion', 'BubbleMap', 'Calendar', 'ComboBox', 'CopyField', 'DataTable', 'DatePicker', 'DateRangePicker', 'DropdownMenu', 'FileDropzone', 'FlowGraph', 'Input', 'ListBox',
  'OtpInput', 'Rating', 'Select', 'Tabs', 'Terminal', 'Textarea',
  'Alert', 'AvatarGroup', 'ButtonGroup', 'CheckboxGroup', 'EmptyNotice', 'FilterButtonGroup', 'Footer', 'IdentityLockup', 'Pagination', 'RadioGroup',
  'SegmentedControl', 'Sidebar', 'Stepper', 'TagGroup', 'Timeline', 'Toaster', 'TopBar',
]);
/** Components that lost `className`: the stylesheet and the structure decide the look. `Freestyle` is the one hole and keeps it. */
const NO_CLASS_NAME = new Set([...NO_CHILDREN, ...LABEL_ONLY, ...CHILD_TO_PROP.keys(), 'Page', 'PaneGrid', 'NavLandmark', 'GrammarRoot', 'HorizontalScrollRegion', 'VerticalScrollRegion', 'WorkspaceShell', 'Stack', 'Cluster', 'Grid']);

interface Resolved { name: string }

/** The JSX text between two tags as React reads it: lines trimmed and joined by one space, blank lines dropped. */
function jsxText(raw: string): string {
  return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ');
}

/** Migrate nested JSX children to named props and report the cases the types now refuse; a case with no mechanical rewrite keeps its source. */
export function transformTierBinding({ ts, text, file = 'component.tsx' }: { ts: Ts; text: string; file?: string }): { text: string; changes: TierBindingChange[]; findings: TierBindingFinding[] } {
  const changes: TierBindingChange[] = [];
  const findings: TierBindingFinding[] = [];
  if (!text.includes('@starci/grammar')) return { text, changes, findings };
  const syntax = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest } }).diagnostics ?? [];
  if (syntax.length) return { text, changes, findings: [{ file, line: 1, column: 1, code: 'PARSE_ERROR', reason: ts.flattenDiagnosticMessageText(syntax[0]?.messageText ?? '', '\n') }] };
  let current = text;
  // A child moves into a prop of its parent; the parent's own parent may then be rewritten too, so passes run until nothing changes.
  for (let pass = 0; pass < 12; pass += 1) {
    const result = onePass({ ts, text: current, file });
    if (pass === 0) findings.push(...result.findings);
    changes.push(...result.changes);
    if (result.text === current) break;
    current = result.text;
  }
  return { text: current, changes, findings };
}

function onePass({ ts, text, file }: { ts: Ts; text: string; file: string }): { text: string; changes: TierBindingChange[]; findings: TierBindingFinding[] } {
  const changes: TierBindingChange[] = [];
  const findings: TierBindingFinding[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);
  const locals = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !GRAMMAR.test(statement.moduleSpecifier.text)) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
    if (named && ts.isNamedImports(named)) for (const specifier of named.elements) locals.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
  }
  if (!locals.size && !namespaces.size) return { text, changes, findings };

  const resolve = (tag: TsTypes.JsxTagNameExpression): Resolved | null => {
    if (ts.isIdentifier(tag)) {
      const imported = locals.get(tag.text);
      return imported !== undefined && !shadowed(ts, tag) ? { name: imported } : null;
    }
    if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text) && !shadowed(ts, tag.expression)) return { name: tag.name.text };
    return null;
  };
  const flag = (node: Node, code: string, reason: string, component: string): void => {
    findings.push({ file, ...sourceLocation(source, node), code, reason, component, source: node.getText(source).slice(0, 200) });
  };

  const rewrites: { element: TsTypes.JsxElement; edit: Edit; change: TierBindingChange }[] = [];
  const visitElement = (element: Element): void => {
    const opening = ts.isJsxElement(element) ? element.openingElement : element;
    const resolved = resolve(opening.tagName);
    if (resolved === null) return;
    const { name } = resolved;
    const attributes = opening.attributes.properties;
    const hasSpread = attributes.some(ts.isJsxSpreadAttribute);
    if (NO_CLASS_NAME.has(name) && attributes.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className')) {
      flag(opening, 'CLASS_NAME_REMOVED', `${name} takes no className: the structure and the role props decide the look; remove it, or state the role with the component that owns it`, name);
    }
    if (name === 'Tooltip' && attributes.some(attribute => ts.isJsxAttribute(attribute) && ['isDisabledTrigger', 'triggerDescribedBy'].includes(attribute.name.getText(source)))) {
      flag(opening, 'TOOLTIP_DISABLED_TRIGGER', 'Tooltip no longer wraps a disabled control: give the Button `disabledReason`, which shows these words itself', name);
    }
    if (!ts.isJsxElement(element)) return;
    const children = element.children.filter(child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces));
    if (!children.length) return;
    const toProp = CHILD_TO_PROP.get(name);
    if (toProp !== undefined) {
      if (hasSpread) { flag(element, 'SPREAD_PROPS', `${name} takes a spread: move the child into \`${toProp.prop}\` by hand`, name); return; }
      let value: string | null = null;
      const only = children.length === 1 ? children[0] : undefined;
      if (toProp.text === true) {
        if (only !== undefined && ts.isJsxText(only)) value = `{${JSON.stringify(jsxText(only.getText(source)))}}`;
        else if (only !== undefined && ts.isJsxExpression(only) && only.expression !== undefined) value = `{${only.expression.getText(source)}}`;
        else { flag(element, 'CHILD_NOT_TEXT', `${name} \`${toProp.prop}\` is a string: the child is not plain text, move it by hand`, name); return; }
      } else if (only !== undefined && ts.isJsxExpression(only) && only.expression !== undefined) value = `{${only.expression.getText(source)}}`;
      else if (only !== undefined && ts.isJsxText(only)) value = `{${JSON.stringify(jsxText(only.getText(source)))}}`;
      else value = `{<>${element.children.map(child => source.text.slice(child.pos, child.end)).join('')}</>}`;
      if (only !== undefined && (ts.isJsxElement(only) || ts.isJsxSelfClosingElement(only) || ts.isJsxFragment(only))) value = `{${only.getText(source)}}`;
      const head = opening.getText(source).replace(/>$/, '').trimEnd();
      const replacement = `${head} ${toProp.prop}=${value} />`;
      rewrites.push({ element, edit: { start: element.getStart(source), end: element.end, text: replacement }, change: { file, ...sourceLocation(source, element), code: 'CHILD_TO_PROP', from: `<${name}>…</${name}>`, to: `<${name} ${toProp.prop}={…} />` } });
      return;
    }
    if (LABEL_ONLY.has(name)) {
      const first = children[0];
      const textual = children.length === 1 && first !== undefined && (ts.isJsxText(first) || ts.isJsxExpression(first));
      if (!textual) flag(element, 'LABEL_NOT_TEXT', `${name} takes one text label as its child; its content is not plain text, move the glyph to startContent or endContent and keep the words`, name);
      return;
    }
    if (NO_CHILDREN.has(name)) flag(element, 'TAKES_NO_CHILDREN', `${name} draws a fixed anatomy from its props and takes no children: place the content in the prop or slot that names its role`, name);
  };
  const innermost = new Set<TsTypes.JsxElement>();
  const visit = (node: Node): void => {
    if (ts.isJsxElement(node)) visitElement(node);
    else if (ts.isJsxSelfClosingElement(node)) visitElement(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  // Only a rewrite with no other rewrite inside it runs in this pass; the next pass takes the parent.
  for (const entry of rewrites) if (!rewrites.some(other => other !== entry && other.edit.start >= entry.edit.start && other.edit.end <= entry.edit.end)) innermost.add(entry.element);
  const applied = rewrites.filter(entry => innermost.has(entry.element)).sort((a, b) => b.edit.start - a.edit.start);
  let output = text;
  for (const entry of applied) {
    output = output.slice(0, entry.edit.start) + entry.edit.text + output.slice(entry.edit.end);
    changes.push(entry.change);
  }
  return { text: output, changes, findings };
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : sourceFiles(target);
    return entry.isFile() && /\.[jt]sx$/i.test(entry.name) ? [target] : [];
  }).sort();
}

/** Preview or apply the safe rewrites in one app's FE tree (`fe/`, or `src/` and `stories/` of a single-side app); every unresolved case is kept in the returned report. */
export function migrateTierBinding({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; write?: boolean; ts?: Ts | null }): TierBindingReport {
  if (!ts) throw new Error('tier-binding needs TypeScript installed in the app or @starci/hfs development checkout');
  const folders = ['fe', 'src', 'stories'].map(name => path.join(root, name)).filter(folder => fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory());
  if (!folders.length) throw new Error('tier-binding runs at an app root with a fe/ directory');
  const report: TierBindingReport = { schema: 'starci/tier-binding-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of folders.flatMap(sourceFiles)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformTierBinding({ ts, text: original, file });
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

/** Render the migration and what is left for a person as Markdown; JSON consumers read the same report object. */
export function tierBindingMarkdown(report: TierBindingReport): string {
  const out = ['# tier-binding', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'changed' : 'would change'}, ${report.changes.length} rewrites, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| location | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(`${finding.file}:${finding.line}:${finding.column}`)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Rewrites', '', '| location | code | from | to |', '|---|---|---|---|');
    for (const item of report.changes) out.push(`| ${cell(`${item.file}:${item.line}:${item.column}`)} | ${item.code} | \`${cell(item.from)}\` | \`${cell(item.to)}\` |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
