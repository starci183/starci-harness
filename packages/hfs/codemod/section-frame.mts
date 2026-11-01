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
type Opening = TsTypes.JsxOpeningElement | TsTypes.JsxSelfClosingElement;
type Element = TsTypes.JsxElement | TsTypes.JsxSelfClosingElement;
type Attribute = TsTypes.JsxAttribute;

/** One Grammar import specifier: the exported name, the local name and the declaration that brought it in. */
interface Binding { imported: string; local: string; declaration: TsTypes.ImportDeclaration; specifier: TsTypes.ImportSpecifier }
/** A JSX tag resolved to a Grammar export, through a named (possibly aliased) import or a namespace import. */
interface Reference { name: string; namespace: string | null; binding: Binding | null }
/** One text edit of the source. */
interface Edit { start: number; end: number; text: string }
/** One safe rewrite of the report. */
export interface SectionFrameChange { file: string; line: number; column: number; code: string; from: string; to: string }
/** One case left for a person. */
export interface SectionFrameFinding { file: string; line: number; column: number; code: string; reason: string; component?: string; source?: string }
/** The report of a migration (`starci app codemod section-frame`). */
export interface SectionFrameReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: SectionFrameChange[]; findings: SectionFrameFinding[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = /^@starci\/grammar(?:\/|$)/;
const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);

/** Exports whose JSX elements become a fragment: the placement they supplied is now read from the structure. */
const UNWRAPPED = new Set(['CollectionItem', 'ItemActions', 'ToolbarActions']);
/** Exports a person migrates: the finding sits on the import (and on a namespace member use). */
const REMOVED: ReadonlyMap<string, { code: string; reason: string }> = new Map([
  ['List', { code: 'LIST_REMOVED', reason: 'List is gone: a long list that searches or filters is Section kind="list" with items (rows from data), a short one is SurfaceCard kind="list"' }],
  ['ListItem', { code: 'LIST_REMOVED', reason: 'ListItem is gone: a row is an item of Section kind="list" or of a list card; custom content goes in the item detail field' }],
  ['LeadingNumber', { code: 'LEADING_NUMBER_REMOVED', reason: 'LeadingNumber is gone: a row of an ordered list takes position: n' }],
  ['Label', { code: 'LABEL_REMOVED', reason: 'Label is gone: a card names itself with label, a field with its own label prop' }],
  ['RegionProps', { code: 'SECTION_TYPES', reason: 'RegionProps is gone: type the section as SectionProps' }],
  ['RegionSpacing', { code: 'SECTION_TYPES', reason: 'RegionSpacing is gone: the space around a section is a role of its parent' }],
  ['SectionHeaderProps', { code: 'SECTION_TYPES', reason: 'SectionHeaderProps is gone: the head is SectionHeadProps, and a section is SectionProps' }],
  ['ListProps', { code: 'SECTION_TYPES', reason: 'ListProps is gone with List' }],
  ['ListItemProps', { code: 'SECTION_TYPES', reason: 'ListItemProps is gone with ListItem' }],
  ['LeadingNumberProps', { code: 'SECTION_TYPES', reason: 'LeadingNumberProps is gone with LeadingNumber' }],
  ['LabelProps', { code: 'SECTION_TYPES', reason: 'LabelProps is gone with Label' }],
  ['CollectionItemProps', { code: 'SECTION_TYPES', reason: 'CollectionItemProps is gone with CollectionItem' }],
  ['ItemActionsProps', { code: 'SECTION_TYPES', reason: 'ItemActionsProps is gone with ItemActions' }],
  ['ToolbarActionsProps', { code: 'SECTION_TYPES', reason: 'ToolbarActionsProps is gone with ToolbarActions' }],
  ['TextWeight', { code: 'SECTION_TYPES', reason: 'TextWeight is gone: Text takes isStrong' }],
]);
/** The `SectionHeader` props that move to `Section` as they are. */
const HEAD_PROPS = new Set(['title', 'description', 'count', 'meta', 'action', 'isSkeleton']);
/** The `Region` props that are dropped: the title names the section, and the space around it is its parent's role. */
const REGION_DROPPED = new Set(['label', 'labelledBy', 'spacing']);

/** Migrate Region, SectionHeader, the placement providers and `Text weight`; a case with no mechanical rewrite keeps its source and gains a finding. */
export function transformSectionFrame({ ts, text, file = 'component.tsx' }: { ts: Ts; text: string; file?: string }): { text: string; changes: SectionFrameChange[]; findings: SectionFrameFinding[] } {
  const changes: SectionFrameChange[] = [];
  const findings: SectionFrameFinding[] = [];
  if (!text.includes('@starci/grammar')) return { text, changes, findings };
  const syntax = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest } }).diagnostics ?? [];
  if (syntax.length) return { text, changes, findings: [{ file, line: 1, column: 1, code: 'PARSE_ERROR', reason: ts.flattenDiagnosticMessageText(syntax[0]?.messageText ?? '', '\n') }] };
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);

  const bindings = new Map<string, Binding>();
  const namespaces = new Set<string>();
  const foreign = new Set<string>();
  const grammarDeclarations: TsTypes.ImportDeclaration[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const grammar = ts.isStringLiteral(statement.moduleSpecifier) && GRAMMAR.test(statement.moduleSpecifier.text);
      if (grammar) grammarDeclarations.push(statement);
      if (clause?.name) foreign.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) (grammar ? namespaces : foreign).add(named.name.text);
      if (named && ts.isNamedImports(named)) {
        for (const specifier of named.elements) {
          if (grammar) bindings.set(specifier.name.text, { imported: specifier.propertyName?.text ?? specifier.name.text, local: specifier.name.text, declaration: statement, specifier });
          else foreign.add(specifier.name.text);
        }
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) foreign.add(statement.name.text);
    else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) foreign.add(declaration.name.text);
  }
  if (!bindings.size && !namespaces.size) return { text, changes, findings };

  const edits: Edit[] = [];
  const gone = new Set<Node>();
  const consumed = new Set<Node>();
  const additions = new Map<TsTypes.ImportDeclaration, string[]>();
  const added = new Set<string>();
  const edit = (start: number, end: number, replacement: string): void => { edits.push({ start, end, text: replacement }); };
  const flag = (node: Node, code: string, reason: string, component?: string): void => {
    findings.push({ file, ...sourceLocation(source, node), code, reason, ...(component === undefined ? {} : { component }), source: node.getText(source).slice(0, 200) });
  };
  const change = (node: Node, code: string, from: string, to: string): void => { changes.push({ file, ...sourceLocation(source, node), code, from, to }); };
  const boundTo = (name: string): Binding | undefined => [...bindings.values()].find(binding => binding.imported === name);

  /** The text to write for the Grammar export `name` next to `reference`: an existing binding, the namespace member, or a new specifier in the same declaration. */
  const use = (name: string, reference: Reference): string | null => {
    if (reference.namespace) return `${reference.namespace}.${name}`;
    const existing = boundTo(name);
    if (existing) return existing.local;
    if (added.has(name)) return name;
    if (foreign.has(name) || !reference.binding) return null;
    added.add(name);
    additions.set(reference.binding.declaration, [...additions.get(reference.binding.declaration) ?? [], name]);
    return name;
  };

  const references = new Map<string, TsTypes.Identifier[]>();
  const isReference = (identifier: TsTypes.Identifier): boolean => {
    const parent = identifier.parent;
    if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
    if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent) || ts.isJsxAttribute(parent) || ts.isEnumMember(parent)) && parent.name === identifier) return false;
    if (ts.isQualifiedName(parent) && parent.right === identifier) return false;
    return !(ts.isBindingElement(parent) && parent.propertyName === identifier);
  };
  const collect = (node: Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && bindings.has(node.text) && isReference(node) && !shadowed(ts, node)) references.set(node.text, [...references.get(node.text) ?? [], node]);
    ts.forEachChild(node, collect);
  };
  collect(source);

  const spread = (opening: Opening): boolean => opening.attributes.properties.some(ts.isJsxSpreadAttribute);
  const attributesOf = (opening: Opening): Map<string, Attribute> => new Map(opening.attributes.properties.filter(ts.isJsxAttribute).map((prop): [string, Attribute] => [prop.name.getText(source), prop]));
  const literal = (attribute: Attribute | undefined): string | null => {
    const value = attribute?.initializer;
    if (value && ts.isStringLiteralLike(value)) return value.text;
    return value && ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression) ? value.expression.text : null;
  };
  const numberLiteral = (attribute: Attribute | undefined): number | null => {
    const value = attribute?.initializer;
    const expression = value && ts.isJsxExpression(value) ? value.expression : undefined;
    return expression && ts.isNumericLiteral(expression) ? Number(expression.text) : null;
  };
  const meaningful = (element: TsTypes.JsxElement): TsTypes.JsxChild[] => element.children.filter(child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces) && !(ts.isJsxExpression(child) && !child.expression));
  const removeAttribute = (attribute: Attribute): void => { edit(attribute.getFullStart(), attribute.end, ''); };
  /** Delete a JSX child with the whitespace text before it, so no blank line is left behind. */
  const removeChild = (element: Element): void => {
    const parent = element.parent;
    const children: readonly TsTypes.JsxChild[] = ts.isJsxElement(parent) || ts.isJsxFragment(parent) ? parent.children : [];
    const previous = children[children.indexOf(element) - 1];
    const start = previous && ts.isJsxText(previous) && previous.containsOnlyTriviaWhiteSpaces ? previous.getFullStart() : element.getStart(source);
    edit(start, element.end, '');
  };
  const retagName = (element: Element, opening: Opening, tag: string): void => {
    edit(opening.tagName.getStart(source), opening.tagName.end, tag);
    if (ts.isIdentifier(opening.tagName)) gone.add(opening.tagName);
    if (ts.isJsxElement(element)) {
      edit(element.closingElement.tagName.getStart(source), element.closingElement.tagName.end, tag);
      if (ts.isIdentifier(element.closingElement.tagName)) gone.add(element.closingElement.tagName);
    }
  };
  const resolve = (tag: TsTypes.JsxTagNameExpression): Reference | null => {
    if (ts.isIdentifier(tag)) {
      const binding = bindings.get(tag.text);
      return binding && !shadowed(ts, tag) ? { name: binding.imported, namespace: null, binding } : null;
    }
    if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && namespaces.has(tag.expression.text) && !shadowed(ts, tag.expression)) return { name: tag.name.text, namespace: tag.expression.text, binding: null };
    return null;
  };
  const resolved = (child: TsTypes.JsxChild, name: string): { element: Element; opening: Opening; reference: Reference } | null => {
    const element = ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) ? child : null;
    if (!element) return null;
    const opening = ts.isJsxElement(element) ? element.openingElement : element;
    const reference = resolve(opening.tagName);
    return reference && reference.name === name ? { element, opening, reference } : null;
  };

  /**
   * The `Section` props a `SectionHeader` becomes, or the reason it cannot: its eyebrow and context-intro composition are gone,
   * a title is not a heading at rank 1, and a className or a spread has no home.
   */
  const headProps = (opening: Opening): { attrs: string[]; id: Attribute | null; blocked: string | null } => {
    if (spread(opening)) return { attrs: [], id: null, blocked: 'spread props may carry a prop Section lacks; rewrite by hand' };
    const props = attributesOf(opening);
    const attrs: string[] = [];
    let id: Attribute | null = null;
    let rank: string | null = null;
    for (const [name, attribute] of props) {
      if (HEAD_PROPS.has(name)) attrs.push(attribute.getText(source));
      else if (name === 'id') id = attribute;
      else if (name === 'level') {
        const level = numberLiteral(attribute);
        if (level === null) return { attrs, id, blocked: 'level is not a number literal; Section takes headingLevel 2 to 6' };
        if (level === 1) return { attrs, id, blocked: 'a Section is never the page title (rank 1): use the page header, or headingLevel 2 under it' };
        if (level !== 2) rank = `headingLevel={${level}}`;
      } else if (name === 'eyebrow') return { attrs, id, blocked: 'eyebrow is gone from the head: say it in the description or the page header' };
      else if (name === 'composition') return { attrs, id, blocked: 'composition is gone: the head has one anatomy' };
      else return { attrs, id, blocked: `${name} has no home on Section` };
    }
    if (!props.has('title')) return { attrs, id, blocked: 'a Section needs a title' };
    if (rank !== null) attrs.push(rank);
    return { attrs, id, blocked: null };
  };

  const visitRegion = (element: Element, opening: Opening, reference: Reference): void => {
    const component = opening.tagName.getText(source);
    const tag = use('Section', reference);
    if (tag === null) { flag(element, 'IMPORT_NAME_CONFLICT', 'Section is already bound to something that is not the grammar export; rewrite by hand', component); return; }
    if (spread(opening)) { flag(element, 'SPREAD_PROPS', 'spread props may carry a prop Section lacks; rewrite by hand', component); return; }
    const props = attributesOf(opening);
    const others = [...props.keys()].filter(name => !REGION_DROPPED.has(name) && name !== 'id');
    if (others.length) { flag(element, 'REGION_PROPS', `${others.join(', ')} has no home on Section: a section has no props of its own beyond its head and id`, component); return; }
    const children = ts.isJsxElement(element) ? meaningful(element) : [];
    const first = children[0] === undefined ? null : resolved(children[0], 'SectionHeader');
    if (first === null) {
      // No head to merge: the label becomes a title, which draws a visible heading the region did not have.
      const label = props.get('label');
      const value = label?.initializer;
      if (!label || !value) { flag(element, 'REGION_WITHOUT_HEAD', 'a Region named by labelledBy without a SectionHeader first in it: give the Section a title by hand', component); return; }
      retagName(element, opening, tag);
      edit(label.name.getStart(source), label.name.end, 'title');
      for (const name of ['labelledBy', 'spacing']) { const attribute = props.get(name); if (attribute) removeAttribute(attribute); }
      change(element, 'REGION_SECTION', 'Region label', 'Section title');
      flag(opening, 'SECTION_NEW_VISIBLE_TITLE', 'the label is now the section\'s visible heading: check the page does not already show it, or drop the Section', component);
      return;
    }
    const head = headProps(first.opening);
    if (head.blocked) { consumed.add(first.element); flag(first.element, 'SECTION_HEADER_KEPT', head.blocked, first.opening.tagName.getText(source)); return; }
    retagName(element, opening, tag);
    for (const name of REGION_DROPPED) { const attribute = props.get(name); if (attribute) removeAttribute(attribute); }
    const anchor = head.id !== null && !props.has('id') && !props.has('labelledBy') ? ` id=${head.id.initializer?.getText(source) ?? '""'}` : '';
    edit(opening.tagName.end, opening.tagName.end, ` ${head.attrs.join(' ')}${anchor}`.replace(/\s+$/, ''));
    removeChild(first.element);
    consumed.add(first.element);
    if (ts.isIdentifier(first.opening.tagName)) gone.add(first.opening.tagName);
    if (ts.isJsxElement(first.element) && ts.isIdentifier(first.element.closingElement.tagName)) gone.add(first.element.closingElement.tagName);
    change(element, 'REGION_SECTION', 'Region + SectionHeader', 'Section');
  };

  const visitStandaloneHeader = (element: Element, opening: Opening, reference: Reference): void => {
    const component = opening.tagName.getText(source);
    const head = headProps(opening);
    if (head.blocked) { flag(element, 'SECTION_HEADER_FREE', head.blocked, component); return; }
    const parent = element.parent;
    const siblings = ts.isJsxElement(parent) || ts.isJsxFragment(parent) ? parent.children.filter(child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces)) : [];
    const plain = ts.isJsxFragment(parent) || (ts.isJsxElement(parent) && /^(?:div|section)$/.test(parent.openingElement.tagName.getText(source)) && parent.openingElement.attributes.properties.length === 0);
    if (!plain || siblings[0] !== element || siblings.length < 2) {
      flag(element, 'SECTION_HEADER_FREE', 'a heading that does not lead a plain wrapper of what it heads: wrap that content in a Section by hand', component);
      return;
    }
    const tag = use('Section', reference);
    if (tag === null) { flag(element, 'IMPORT_NAME_CONFLICT', 'Section is already bound to something that is not the grammar export; rewrite by hand', component); return; }
    const attrs = [...head.attrs, ...(head.id === null ? [] : [head.id.getText(source)])].join(' ');
    if (ts.isJsxFragment(parent)) {
      edit(parent.openingFragment.getStart(source), parent.openingFragment.end, `<${tag} ${attrs}>`);
      edit(parent.closingFragment.getStart(source), parent.closingFragment.end, `</${tag}>`);
    } else if (ts.isJsxElement(parent)) {
      edit(parent.openingElement.getStart(source), parent.openingElement.end, `<${tag} ${attrs}>`);
      edit(parent.closingElement.getStart(source), parent.closingElement.end, `</${tag}>`);
    }
    removeChild(element);
    consumed.add(element);
    if (ts.isIdentifier(opening.tagName)) gone.add(opening.tagName);
    if (ts.isJsxElement(element) && ts.isIdentifier(element.closingElement.tagName)) gone.add(element.closingElement.tagName);
    change(element, 'SECTION_HEADER_SECTION', 'SectionHeader + siblings', 'Section');
  };

  const visitText = (element: Element, opening: Opening): void => {
    const component = opening.tagName.getText(source);
    const props = attributesOf(opening);
    let strong = props.has('isStrong');
    const weight = props.get('weight');
    if (weight) {
      const value = literal(weight);
      if (value === 'medium' || value === 'semibold') { change(weight, 'TEXT_IS_STRONG', weight.getText(source), 'isStrong'); edit(weight.getStart(source), weight.end, 'isStrong'); strong = true; }
      else if (value === 'normal') { change(weight, 'TEXT_IS_STRONG', weight.getText(source), ''); removeAttribute(weight); }
      else flag(weight, 'TEXT_WEIGHT_DYNAMIC', 'weight is not a literal: Text takes isStrong, a boolean', component);
    }
    if (props.has('parentEmphasis')) flag(props.get('parentEmphasis') ?? opening, 'TEXT_PARENT_EMPHASIS', 'parentEmphasis is gone: the accent on a selected parent has no replacement; the selection draws itself', component);
    if (literal(props.get('size')) === 'metric-lead') flag(props.get('size') ?? opening, 'TEXT_METRIC_LEAD', 'size="metric-lead" is gone: a key figure is a SurfaceCard kind="figures" item', component);
    if (literal(props.get('tone')) === 'accent') flag(props.get('tone') ?? opening, 'TEXT_TONE_ACCENT', 'tone="accent" is gone: a mention is Text isStrong, a destination is Link', component);
    // A strong block line that heads a group of blocks is a heading wearing a weight.
    const as = literal(props.get('as'));
    const parent = element.parent;
    if (strong && (as === null && !props.has('as') || as === 'div' || as === 'p') && ts.isJsxElement(parent)) {
      const siblings = meaningful(parent);
      if (siblings[0] === element && siblings.length > 1) flag(element, 'TEXT_HEADING_FAKE', 'a strong Text that heads a group: the group is a Section (its title), a card (its label) or a field (its label), not a weight', component);
    }
  };

  const visit = (node: Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const reference = resolve(opening.tagName);
      if (reference && !consumed.has(node)) {
        if (reference.name === 'Region') visitRegion(node, opening, reference);
        else if (reference.name === 'SectionHeader') visitStandaloneHeader(node, opening, reference);
        else if (reference.name === 'Text') visitText(node, opening);
        else if (UNWRAPPED.has(reference.name)) {
          if (ts.isJsxElement(node)) {
            edit(node.openingElement.getStart(source), node.openingElement.end, '<>');
            edit(node.closingElement.getStart(source), node.closingElement.end, '</>');
          } else edit(node.getStart(source), node.end, '<></>');
          if (ts.isIdentifier(opening.tagName)) gone.add(opening.tagName);
          if (ts.isJsxElement(node) && ts.isIdentifier(node.closingElement.tagName)) gone.add(node.closingElement.tagName);
          change(node, 'PLACEMENT_PROVIDER_REMOVED', reference.name, 'fragment');
        } else if (REMOVED.has(reference.name)) {
          const removed = REMOVED.get(reference.name);
          if (removed) flag(node, removed.code, removed.reason, opening.tagName.getText(source));
        }
      }
    }
    if ((ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) || (ts.isQualifiedName(node) && namespaces.has(node.left.getText(source)))) {
      const member = ts.isPropertyAccessExpression(node) ? node.name : node.right;
      const removed = REMOVED.get(member.text);
      const isTag = ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent) || ts.isJsxClosingElement(node.parent);
      if (removed && !isTag && ts.isQualifiedName(node)) flag(node, removed.code, removed.reason);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Imports left for a person: the removed names that are still referenced after the rewrites.
  for (const binding of bindings.values()) {
    const removed = REMOVED.get(binding.imported);
    if (!removed) continue;
    const left = (references.get(binding.local) ?? []).filter(identifier => !gone.has(identifier));
    const taggedOnly = left.every(identifier => ts.isJsxOpeningElement(identifier.parent) || ts.isJsxSelfClosingElement(identifier.parent) || ts.isJsxClosingElement(identifier.parent));
    if (!left.length || !taggedOnly) flag(binding.specifier, removed.code, removed.reason);
  }

  const dropped = new Set<TsTypes.ImportSpecifier>();
  for (const binding of bindings.values()) {
    if (!['Region', 'SectionHeader', ...UNWRAPPED].includes(binding.imported)) continue;
    const refs = references.get(binding.local) ?? [];
    if (!refs.length || refs.every(identifier => gone.has(identifier))) dropped.add(binding.specifier);
  }
  for (const declaration of grammarDeclarations) {
    const named = declaration.importClause?.namedBindings;
    const clause = declaration.importClause;
    if (!clause || !named || !ts.isNamedImports(named)) continue;
    const adds = additions.get(declaration) ?? [];
    if (!adds.length && !named.elements.some(specifier => dropped.has(specifier))) continue;
    const kept = named.elements.filter(specifier => !dropped.has(specifier)).map(specifier => specifier.getText(source));
    const list = [...kept, ...adds];
    if (!list.length) {
      if (clause.name) edit(clause.name.end, named.end, '');
      else edit(declaration.getStart(source), declaration.end + (text.startsWith('\r\n', declaration.end) ? 2 : text.startsWith('\n', declaration.end) ? 1 : 0), '');
    } else edit(named.getStart(source), named.end, /\n/.test(named.getText(source)) ? `{\n  ${list.join(',\n  ')},\n}` : `{ ${list.join(', ')} }`);
  }

  edits.sort((first, second) => first.start - second.start || first.end - second.end);
  const unique: Edit[] = [];
  for (const current of edits) {
    const previous = unique.at(-1);
    if (previous && previous.start === current.start && previous.end === current.end && previous.text === current.text) continue;
    if (previous && current.start < previous.end) {
      return { text, changes: [], findings: [...findings, { file, line: 1, column: 1, code: 'EDIT_CONFLICT', reason: 'two rewrites overlap (a nested grammar element inside a rewritten one): nothing in this file was changed; migrate by hand' }] };
    }
    unique.push(current);
  }
  let output = text;
  for (const current of unique.reverse()) output = output.slice(0, current.start) + current.text + output.slice(current.end);
  return { text: output, changes, findings };
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : sourceFiles(target);
    return entry.isFile() && /\.[jt]sx$/i.test(entry.name) ? [target] : [];
  }).sort();
}

/** Preview or apply the safe rewrites in one app's FE tree; every unresolved case is retained in the returned report. */
export function migrateSectionFrame({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; write?: boolean; ts?: Ts | null }): SectionFrameReport {
  if (!ts) throw new Error('section-frame needs TypeScript installed in the app or @starci/hfs development checkout');
  const frontend = path.join(root, 'fe');
  if (!fs.statSync(frontend, { throwIfNoEntry: false })?.isDirectory()) throw new Error('section-frame runs at an app root with a fe/ directory');
  const report: SectionFrameReport = { schema: 'starci/section-frame-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of sourceFiles(frontend)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformSectionFrame({ ts, text: original, file });
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
export function sectionFrameMarkdown(report: SectionFrameReport): string {
  const out = ['# section-frame', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'changed' : 'would change'}, ${report.changes.length} rewrites, ${report.findings.length} left for a person.`, ''];
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
