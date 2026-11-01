import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { sourceLocation } from '../runtime/scripts/lib/ts-ast.mjs';
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
export interface SmallRenamesChange { file: string; line: number; column: number; code: string; from: string; to: string }
/** One case left for a person. */
export interface SmallRenamesFinding { file: string; line: number; column: number; code: string; reason: string; component?: string; source?: string }
/** The report of a migration (`starci app codemod small-renames`). */
export interface SmallRenamesReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: SmallRenamesChange[]; findings: SmallRenamesFinding[];
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = /^@starci\/grammar(?:\/|$)/;
const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);

/** Exports renamed one to one: the import specifier and every reference move. */
const RENAMES: ReadonlyMap<string, string> = new Map([
  ['ChatBubble', 'MessageBubble'], ['ChatBubbleProps', 'MessageBubbleProps'], ['ChatBubbleSide', 'MessageBubbleSide'],
  ['flowGraphDiameter', 'bubbleDiameter'], ['orbitLayout', 'bubbleMapLayout'],
]);
/** Exports whose JSX uses are rewritten into another element: the import goes when nothing else uses it. */
const REPLACED = new Set(['ChatBubbleSkeletons', 'StatusDot', 'ConnectionStatus', 'CloseButton', 'TextAction', 'FlowGraph', 'SurfaceCopyGroup']);
/** Exports a person migrates: the finding sits on the import (and on a namespace member use). */
const REMOVED: ReadonlyMap<string, { code: string; reason: string }> = new Map([
  ['Backdrop', { code: 'REMOVED_COMPONENT', reason: 'Backdrop is gone: a tinted brand ground is a soft card or Freestyle' }],
  ['RankArtwork', { code: 'REMOVED_COMPONENT', reason: 'RankArtwork is gone: move the artwork into the app as assets' }],
  ['IncludedMark', { code: 'REMOVED_COMPONENT', reason: 'IncludedMark is gone: use Icon with a check glyph' }],
  ['foldForSearch', { code: 'REMOVED_EXPORT', reason: 'foldForSearch is no longer exported from the grammar' }],
  ['ChatBubbleSkeletonsProps', { code: 'CHAT_BUBBLE_SKELETONS_PROPS', reason: 'ChatBubbleSkeletonsProps is gone: type the skeleton as MessageBubbleProps (isSkeleton, rows, hasAvatar)' }],
  ['ConnectionState', { code: 'CONNECTION_STATUS_TYPES', reason: 'ConnectionState is gone with ConnectionStatus: model the state as the Badge tone (success, warning, danger)' }],
  ['ConnectionStatusProps', { code: 'CONNECTION_STATUS_TYPES', reason: 'ConnectionStatusProps is gone with ConnectionStatus: use BadgeProps' }],
  ['FlowGraphNodeForm', { code: 'FLOW_GRAPH_TYPES', reason: 'FlowGraphNodeForm moved to the bubble map; choose BubbleMapNode field types by hand' }],
  ['FlowGraphFill', { code: 'FLOW_GRAPH_TYPES', reason: 'FlowGraphFill moved to the bubble map; choose BubbleMapNode field types by hand' }],
  ['FlowGraphRingPart', { code: 'FLOW_GRAPH_TYPES', reason: 'FlowGraphRingPart moved to the bubble map; choose BubbleMapNode field types by hand' }],
  ['FlowGraphNode', { code: 'BUBBLE_MAP_NODES', reason: 'FlowGraphNode fields form, mark, caption, diameter, fill and ring now belong to BubbleMapNode: move the nodes of a bubble map by hand' }],
]);
/** Components that lost `variant`: the surface context resolves it. */
const VARIANT_REMOVED = new Set(['Input', 'Textarea', 'SearchField', 'NumberField', 'DateField', 'TimeField', 'PressableField', 'Checkbox', 'CheckboxGroup', 'RadioGroup',
  'Select', 'ComboBox', 'DatePicker', 'DateRangePicker', 'CopyField', 'OtpInput', 'Tabs']);
/** Components that lost `size="control"`: a bar sets it from context. */
const CONTROL_SIZED = new Set(['Button', 'IconButton', 'Input', 'SearchField', 'SegmentedControl']);
/** Components whose `control` step was their `lg`: the attribute becomes `size="lg"`, which draws the same. */
const CONTROL_IS_LG = new Set(['Switch', 'Avatar', 'AvatarButton']);
const TONES: ReadonlyMap<string, string> = new Map([['live', 'success'], ['reconnecting', 'warning'], ['lost', 'danger']]);
const OTP_RENAMES: ReadonlyMap<string, string> = new Map([['disabled', 'isDisabled'], ['invalid', 'isInvalid'], ['onChange', 'onValueChange']]);
const TEXT_ACTION_BLOCKERS = ['appearance', 'size', 'startContent', 'endContent', 'isPending', 'isSkeleton', 'download', 'onPress'];
const FORM_TAG = /^(?:[\w$]+\.)*(?:Form|Fieldset|form|fieldset)$/;
const BUTTON_GROUP_SHAPE = 'actions: ReadonlyArray<{ id: string; label: string; source?: IconSource; onPress?: () => void; isDisabled?: boolean; intent?: "commit" | "alternative" | "neutral" }>';

function bindingNames(ts: Ts, binding: TsTypes.BindingName): string[] {
  if (ts.isIdentifier(binding)) return [binding.text];
  if (ts.isObjectBindingPattern(binding)) return binding.elements.flatMap(element => bindingNames(ts, element.name));
  return binding.elements.flatMap((element): string[] => ts.isBindingElement(element) ? bindingNames(ts, element.name) : []);
}

/** Whether a local declaration (a parameter, a block-level declaration, a loop variable) hides the import `identifier` names. */
function shadowed(ts: Ts, identifier: TsTypes.Identifier): boolean {
  const name = identifier.text;
  for (let at: Node | undefined = identifier.parent; at && !ts.isSourceFile(at); at = at.parent) {
    if (ts.isFunctionLike(at) && (at.parameters.some(parameter => bindingNames(ts, parameter.name).includes(name)) || (ts.isFunctionExpression(at) && at.name?.text === name))) return true;
    if (ts.isCatchClause(at) && at.variableDeclaration && bindingNames(ts, at.variableDeclaration.name).includes(name)) return true;
    for (const statement of ts.isBlock(at) ? at.statements : []) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return true;
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => bindingNames(ts, declaration.name).includes(name))) return true;
    }
    if ((ts.isForStatement(at) || ts.isForOfStatement(at) || ts.isForInStatement(at)) && at.initializer && ts.isVariableDeclarationList(at.initializer)
      && at.initializer.declarations.some(declaration => bindingNames(ts, declaration.name).includes(name))) return true;
  }
  return false;
}

/** Migrate the removed and renamed Grammar names with source edits; a case with no mechanical rewrite keeps its source and gains a finding. */
export function transformSmallRenames({ ts, text, file = 'component.tsx' }: { ts: Ts; text: string; file?: string }): { text: string; changes: SmallRenamesChange[]; findings: SmallRenamesFinding[] } {
  const changes: SmallRenamesChange[] = [];
  const findings: SmallRenamesFinding[] = [];
  if (!text.includes('@starci/grammar')) return { text, changes, findings };
  const syntax = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest } }).diagnostics ?? [];
  if (syntax.length) return { text, changes, findings: [{ file, line: 1, column: 1, code: 'PARSE_ERROR', reason: ts.flattenDiagnosticMessageText(syntax[0]?.messageText ?? '', '\n') }] };
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);

  // Imports: grammar bindings by local name, grammar namespaces, and the names other modules or the file itself already own.
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
    else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) for (const name of bindingNames(ts, declaration.name)) foreign.add(name);
  }
  if (!bindings.size && !namespaces.size) return { text, changes, findings };

  const edits: Edit[] = [];
  const gone = new Set<Node>();
  const additions = new Map<TsTypes.ImportDeclaration, string[]>();
  const added = new Set<string>();
  const typeOnly = new Set<string>();
  const specifierRenames = new Map<TsTypes.ImportSpecifier, string>();
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

  // Every reference of a name, bar property names and import positions, with the shadowed ones left out.
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
  const hasContent = (element: Element): boolean => ts.isJsxElement(element) && element.children.some(child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces));
  const removeAttribute = (attribute: Attribute): void => { edit(attribute.getFullStart(), attribute.end, ''); };
  const renameAttribute = (attribute: Attribute, name: string): void => { edit(attribute.name.getStart(source), attribute.name.end, name); };
  const retag = (element: Element, opening: Opening, tag: string, extra = ''): void => {
    edit(opening.tagName.getStart(source), opening.tagName.end, `${tag}${extra}`);
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
  const conflict = (node: Node, name: string, component: string): void => { flag(node, 'IMPORT_NAME_CONFLICT', `${name} is already bound to something that is not the grammar export; rewrite by hand`, component); };

  // Exports renamed one to one.
  for (const binding of bindings.values()) {
    const to = RENAMES.get(binding.imported);
    if (to === undefined) continue;
    const aliased = binding.local !== binding.imported;
    if (aliased || !references.get(binding.local)?.length) {
      // An alias keeps its uses; an import nothing uses is only respelled.
      specifierRenames.set(binding.specifier, `${binding.specifier.isTypeOnly ? 'type ' : ''}${to}${aliased ? ` as ${binding.local}` : ''}`);
      change(binding.specifier, 'RENAMED_EXPORT', binding.imported, to);
      continue;
    }
    const local = use(to, { name: binding.imported, namespace: null, binding });
    if (local === null) { conflict(binding.specifier, to, binding.imported); continue; }
    change(binding.specifier, 'RENAMED_EXPORT', binding.imported, to);
    if (binding.specifier.isTypeOnly) typeOnly.add(to);
    for (const identifier of references.get(binding.local) ?? []) {
      if (ts.isExportSpecifier(identifier.parent)) continue;
      edit(identifier.getStart(source), identifier.end, ts.isShorthandPropertyAssignment(identifier.parent) ? `${identifier.text}: ${local}` : local);
      gone.add(identifier);
    }
  }

  const visitElement = (element: Element, opening: Opening): void => {
    const reference = resolve(opening.tagName);
    if (!reference) return;
    const name = reference.name;
    const component = opening.tagName.getText(source);
    const props = attributesOf(opening);
    const has = (prop: string): boolean => props.has(prop);
    const drop = (prop: string, code: string): void => { const attribute = props.get(prop); if (attribute) { change(attribute, code, attribute.getText(source), ''); removeAttribute(attribute); } };
    const sizeValue = literal(props.get('size'));

    if (VARIANT_REMOVED.has(name)) drop('variant', 'VARIANT_REMOVED');
    if ((name === 'Button' || name === 'IconButton') && has('variant')) flag(props.get('variant') ?? opening, 'BUTTON_VARIANT', 'run `starci app codemod button-intent` first: that codemod owns variant', component);
    if (CONTROL_SIZED.has(name) && sizeValue === 'control') drop('size', 'SIZE_CONTROL_REMOVED');
    if (CONTROL_IS_LG.has(name) && sizeValue === 'control') { const attribute = props.get('size'); if (attribute) { change(attribute, 'SIZE_CONTROL_LG', attribute.getText(source), 'size="lg"'); edit(attribute.getStart(source), attribute.end, 'size="lg"'); } }

    switch (name) {
      case 'ChatBubble': {
        const skeleton = props.get('isSkeleton');
        const initializer = skeleton?.initializer;
        const isOn = skeleton !== undefined && (initializer === undefined || (ts.isJsxExpression(initializer) && initializer.expression?.kind === ts.SyntaxKind.TrueKeyword));
        const avatar = props.get('avatar');
        if (isOn && avatar) { change(avatar, 'CHAT_BUBBLE_SKELETON', avatar.getText(source), 'hasAvatar'); edit(avatar.getStart(source), avatar.end, 'hasAvatar'); }
        else if (skeleton && avatar && !(initializer && ts.isJsxExpression(initializer) && initializer.expression?.kind === ts.SyntaxKind.FalseKeyword)) {
          flag(avatar, 'CHAT_BUBBLE_SKELETON', 'isSkeleton is dynamic: a skeleton bubble takes hasAvatar instead of avatar', component);
        }
        if (isOn && hasContent(element)) flag(element, 'CHAT_BUBBLE_SKELETON_CHILDREN', 'a skeleton bubble takes no children: remove them', component);
        break;
      }
      case 'ChatBubbleSkeletons': {
        if (spread(opening)) { flag(element, 'SPREAD_PROPS', 'spread props may carry count; rewrite by hand', component); break; }
        if (hasContent(element)) { flag(element, 'CHAT_BUBBLE_SKELETON_CHILDREN', 'ChatBubbleSkeletons takes no children', component); break; }
        const tag = use('MessageBubble', reference);
        if (tag === null) { conflict(element, 'MessageBubble', component); break; }
        const count = props.get('count');
        retag(element, opening, tag, count ? ' isSkeleton' : ' isSkeleton rows={3}');
        if (count) renameAttribute(count, 'rows');
        change(element, 'CHAT_BUBBLE_SKELETONS', 'ChatBubbleSkeletons', 'MessageBubble isSkeleton');
        break;
      }
      case 'StatusDot': {
        if (!hasContent(element) && !has('children')) break;
        if (spread(opening)) { flag(element, 'SPREAD_PROPS', 'spread props may carry size or aria-label; rewrite by hand', component); break; }
        if (has('children')) { flag(element, 'STATUS_DOT_CHILDREN', 'children passed as an attribute; rewrite as Badge isDot by hand', component); break; }
        const tag = use('Badge', reference);
        if (tag === null) { conflict(element, 'Badge', component); break; }
        retag(element, opening, tag, ' isDot');
        for (const prop of ['size', 'aria-label']) drop(prop, 'STATUS_DOT_BADGE');
        const echo = props.get('echo');
        if (echo) renameAttribute(echo, 'isLive');
        change(element, 'STATUS_DOT_BADGE', 'StatusDot', 'Badge isDot');
        break;
      }
      case 'ConnectionStatus': {
        if (spread(opening)) { flag(element, 'SPREAD_PROPS', 'spread props may carry state or label; rewrite by hand', component); break; }
        const state = literal(props.get('state'));
        const tone = state === null ? undefined : TONES.get(state);
        if (tone === undefined) { flag(element, 'CONNECTION_STATUS_STATE', 'state is not a literal live, reconnecting or lost: map it to a Badge tone by hand', component); break; }
        if (hasContent(element)) { flag(element, 'CONNECTION_STATUS_STATE', 'ConnectionStatus takes no children', component); break; }
        const label = props.get('label');
        const value = label?.initializer;
        let child: string | null = null;
        if (value) child = ts.isStringLiteral(value) && !/[{}<>&\n]/.test(value.text) ? value.text : ts.isJsxExpression(value) ? value.getText(source) : `{${value.getText(source)}}`;
        const tag = use('Badge', reference);
        if (tag === null) { conflict(element, 'Badge', component); break; }
        const others = opening.attributes.properties.filter(prop => !(ts.isJsxAttribute(prop) && ['state', 'label'].includes(prop.name.getText(source)))).map(prop => ` ${prop.getText(source)}`).join('');
        const head = `<${tag} isDot tone="${tone}"${state === 'lost' ? '' : ' isLive'}${others}`;
        edit(element.getStart(source), element.end, child === null ? `${head} />` : `${head}>${child}</${tag}>`);
        if (ts.isIdentifier(opening.tagName)) gone.add(opening.tagName);
        if (ts.isJsxElement(element) && ts.isIdentifier(element.closingElement.tagName)) gone.add(element.closingElement.tagName);
        change(element, 'CONNECTION_STATUS_BADGE', `ConnectionStatus state=${state}`, `Badge isDot tone=${tone}`);
        break;
      }
      case 'CloseButton': {
        const tag = use('IconButton', reference);
        if (tag === null) { conflict(element, 'IconButton', component); break; }
        retag(element, opening, tag, has('intent') ? '' : ' intent="dismiss"');
        change(element, 'CLOSE_BUTTON_ICON_BUTTON', 'CloseButton', 'IconButton intent="dismiss"');
        break;
      }
      case 'TextAction': {
        const href = props.get('href');
        if (!href && !spread(opening)) break;
        if (spread(opening)) { flag(element, 'SPREAD_PROPS', 'spread props may carry href or onPress; rewrite by hand', component); break; }
        const target = props.get('target');
        const external = literal(target) === '_blank';
        const blockers = TEXT_ACTION_BLOCKERS.filter(has);
        if (target && !external) blockers.push('target');
        if (has('rel') && !external) blockers.push('rel');
        const text = ts.isJsxElement(element) && element.children.length > 0 && element.children.every(child => ts.isJsxText(child)) && element.children.some(child => ts.isJsxText(child) && !child.containsOnlyTriviaWhiteSpaces);
        if (blockers.length || !text) {
          flag(element, 'TEXT_ACTION_LINK_PROPS', blockers.length ? `Link does not take ${blockers.join(', ')}: choose the Link kind or keep TextAction as a command` : 'Link takes string children only', component);
          break;
        }
        const initializer = href?.initializer;
        const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
        if (!expression || !(ts.isStringLiteralLike(expression) || ts.isTemplateExpression(expression))) {
          flag(element, 'TEXT_ACTION_DYNAMIC_HREF', 'href is not a string literal and may be undefined: a Link needs a destination, a command needs onPress', component);
          break;
        }
        const tag = use('Link', reference);
        if (tag === null) { conflict(element, 'Link', component); break; }
        retag(element, opening, tag);
        if (target && external) edit(target.getStart(source), target.end, 'kind="external"');
        drop('rel', 'TEXT_ACTION_LINK');
        change(element, 'TEXT_ACTION_LINK', 'TextAction', 'Link');
        break;
      }
      case 'EmptyNotice': drop('actionVariant', 'EMPTY_NOTICE_ACTION_VARIANT'); break;
      case 'DragItem': {
        const colour = props.get('leadingColor');
        if (colour) flag(colour, 'DRAG_ITEM_LEADING_COLOR', 'DragItem takes tone: "neutral" | "accent" | "success" | "warning" | "danger"; a colour cannot be mapped', component);
        break;
      }
      case 'SegmentedControl': {
        if (sizeValue === 'lg') drop('size', 'SEGMENTED_SIZE');
        let inForm = false;
        for (let at: Node | undefined = element.parent; at && !inForm; at = at.parent) inForm = ts.isJsxElement(at) && FORM_TAG.test(at.openingElement.tagName.getText(source));
        if (!inForm) flag(opening, 'SEGMENTED_FILTER_OR_VALUE', 'a form value stays a SegmentedControl; a filter becomes FilterButtonGroup: decide which this is', component);
        break;
      }
      case 'ButtonGroup':
        if (hasContent(element) || has('children')) flag(element, 'BUTTON_GROUP_CHILDREN', `ButtonGroup takes an actions array now: ${BUTTON_GROUP_SHAPE}`, component);
        break;
      case 'TagGroup': {
        const selection = ['selectionMode', 'selectedIds', 'defaultSelectedIds', 'onSelectionChange'].filter(has);
        if (selection.length) flag(element, 'TAG_GROUP_SELECTION', `TagGroup lost ${selection.join(', ')}: a selectable group becomes FilterButtonGroup`, component);
        break;
      }
      case 'Input': {
        const invalid = props.get('isError');
        if (invalid) { renameAttribute(invalid, 'isInvalid'); change(invalid, 'FIELD_VOCABULARY', 'isError', 'isInvalid'); }
        break;
      }
      case 'OtpInput':
        for (const [from, to] of OTP_RENAMES) {
          const attribute = props.get(from);
          if (attribute) { renameAttribute(attribute, to); change(attribute, 'FIELD_VOCABULARY', from, to); }
        }
        break;
      case 'FlowGraph': {
        const layout = props.get('layout');
        if (!layout) break;
        const value = literal(layout);
        if (value === null) { flag(layout, 'BUBBLE_MAP_LAYOUT', 'layout is not a literal: only layout="orbit" becomes BubbleMap', component); break; }
        if (value !== 'orbit') break;
        if (spread(opening)) { flag(element, 'SPREAD_PROPS', 'spread props may carry props BubbleMap lacks; rewrite by hand', component); break; }
        const invalid = ['direction', 'headers'].filter(has);
        if (invalid.length) { flag(element, 'BUBBLE_MAP_PROPS', `BubbleMap does not take ${invalid.join(', ')}: remove them, then rewrite as BubbleMap`, component); break; }
        const tag = use('BubbleMap', reference);
        if (tag === null) { conflict(element, 'BubbleMap', component); break; }
        retag(element, opening, tag);
        drop('layout', 'FLOW_GRAPH_BUBBLE_MAP');
        change(element, 'FLOW_GRAPH_BUBBLE_MAP', 'FlowGraph layout="orbit"', 'BubbleMap');
        flag(props.get('nodes') ?? opening, 'BUBBLE_MAP_NODES', 'FlowGraphNode fields form, mark, caption, diameter, fill and ring now belong to BubbleMapNode: check the nodes', component);
        break;
      }
      case 'SurfaceCopyGroup': {
        const density = props.get('density');
        const value = density ? literal(density) : 'compact';
        if (spread(opening) || [...props.keys()].some(prop => prop !== 'density') || (value !== 'comfortable' && value !== 'compact')) {
          flag(element, 'REMOVED_COMPONENT', 'SurfaceCopyGroup is gone: use Stack gap="inline" for density compact, gap="row" for comfortable', component);
          break;
        }
        const tag = use('Stack', reference);
        if (tag === null) { conflict(element, 'Stack', component); break; }
        const gap = value === 'comfortable' ? 'row' : 'inline';
        retag(element, opening, tag, density ? '' : ` gap="${gap}"`);
        if (density) edit(density.getStart(source), density.end, `gap="${gap}"`);
        change(element, 'SURFACE_COPY_GROUP_STACK', 'SurfaceCopyGroup', `Stack gap="${gap}"`);
        break;
      }
      default:
    }
  };

  const visit = (node: Node): void => {
    if (ts.isJsxElement(node)) visitElement(node, node.openingElement);
    else if (ts.isJsxSelfClosingElement(node)) visitElement(node, node);
    // Namespace members outside JSX tags: renames and removed exports (a tag is a property access too).
    if ((ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) || (ts.isQualifiedName(node) && namespaces.has(node.left.getText(source)))) {
      const member = ts.isPropertyAccessExpression(node) ? node.name : node.right;
      const to = RENAMES.get(member.text);
      const removed = REMOVED.get(member.text);
      if (to !== undefined) { edit(member.getStart(source), member.end, to); if (!ts.isJsxClosingElement(node.parent)) change(node, 'RENAMED_EXPORT', member.text, to); }
      if (removed && !ts.isJsxClosingElement(node.parent)) flag(node, removed.code, removed.reason);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Imports left for a person, and the SurfaceCopyGroup uses no element rewrite covered.
  for (const binding of bindings.values()) {
    const removed = REMOVED.get(binding.imported);
    if (removed) flag(binding.specifier, removed.code, removed.reason);
    if (binding.imported === 'SurfaceCopyGroup') {
      const left = (references.get(binding.local) ?? []).filter(identifier => !gone.has(identifier) && !(ts.isJsxOpeningElement(identifier.parent) || ts.isJsxSelfClosingElement(identifier.parent) || ts.isJsxClosingElement(identifier.parent)));
      if (left.length) flag(binding.specifier, 'REMOVED_COMPONENT', 'SurfaceCopyGroup is gone and is used outside a JSX tag: use Stack gap="inline" or gap="row"');
    }
  }

  // Import declarations: drop the specifiers nothing references any more, add the new ones, spell an aliased rename.
  const dropped = new Set<TsTypes.ImportSpecifier>();
  for (const binding of bindings.values()) {
    if (!(RENAMES.has(binding.imported) || REPLACED.has(binding.imported)) || specifierRenames.has(binding.specifier)) continue;
    const refs = references.get(binding.local) ?? [];
    if (refs.length && refs.every(identifier => gone.has(identifier))) dropped.add(binding.specifier);
  }
  for (const declaration of grammarDeclarations) {
    const named = declaration.importClause?.namedBindings;
    const clause = declaration.importClause;
    if (!clause || !named || !ts.isNamedImports(named)) continue;
    const adds = additions.get(declaration) ?? [];
    if (!adds.length && !named.elements.some(specifier => dropped.has(specifier) || specifierRenames.has(specifier))) continue;
    const kept = named.elements.filter(specifier => !dropped.has(specifier)).map(specifier => specifierRenames.get(specifier) ?? specifier.getText(source));
    const list = [...kept, ...adds.map(name => typeOnly.has(name) ? `type ${name}` : name)];
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

/** Preview or apply the safe renames in one app's FE tree; every unresolved case is retained in the returned report. */
export function migrateSmallRenames({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }: { root: string; write?: boolean; ts?: Ts | null }): SmallRenamesReport {
  if (!ts) throw new Error('small-renames needs TypeScript installed in the app or @starci/hfs development checkout');
  const frontend = path.join(root, 'fe');
  if (!fs.statSync(frontend, { throwIfNoEntry: false })?.isDirectory()) throw new Error('small-renames runs at an app root with a fe/ directory');
  const report: SmallRenamesReport = { schema: 'starci/small-renames-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of sourceFiles(frontend)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformSmallRenames({ ts, text: original, file });
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
export function smallRenamesMarkdown(report: SmallRenamesReport): string {
  const out = ['# small-renames', '', `Scanned ${report.filesScanned} files, ${report.filesChanged.length} ${report.write ? 'changed' : 'would change'}, ${report.changes.length} rewrites, ${report.findings.length} left for a person.`, ''];
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
