import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { sourceLocation } from '../runtime/scripts/lib/ts-ast.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = /^@starci\/grammar(?:\/|$)/;
const VARIANTS = Object.freeze({ primary: 'commit', tertiary: 'dismiss', danger: 'destructive', 'danger-soft': 'destructive', outline: 'neutral', ghost: 'neutral' });
const WEAK = new Set(['outline', 'ghost', 'secondary']);
const GENERATED = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage', '.git']);

function attributes(ts, opening) {
  return new Map(opening.attributes.properties.filter(ts.isJsxAttribute).map(prop => [prop.name.getText(), prop]));
}

function literal(ts, attribute) {
  const value = attribute?.initializer;
  if (value && ts.isStringLiteralLike(value)) return value.text;
  return value && ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression) ? value.expression.text : null;
}

function buttonImports(ts, source) {
  const names = new Set();
  const namespaces = new Set();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !GRAMMAR.test(node.moduleSpecifier.text)) continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if (['Button', 'IconButton'].includes(binding.propertyName?.text ?? binding.name.text)) names.add(binding.name.text);
      }
    }
  }
  return { names, namespaces };
}

function isButton(ts, opening, imports) {
  const tag = opening.tagName;
  if (ts.isIdentifier(tag)) return imports.names.has(tag.text);
  return ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression)
    && imports.namespaces.has(tag.expression.text) && ['Button', 'IconButton'].includes(tag.name.text);
}

function bindingNames(ts, binding) {
  if (ts.isIdentifier(binding)) return [binding.text];
  if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) return binding.elements.flatMap(element => ts.isBindingElement(element) ? bindingNames(ts, element.name) : []);
  return [];
}

function shadowedBinding(ts, opening) {
  const tag = opening.tagName;
  const name = ts.isIdentifier(tag) ? tag.text : tag.expression.text;
  for (let at = opening.parent; at && !ts.isSourceFile(at); at = at.parent) {
    if (ts.isFunctionLike(at) && (at.parameters.some(parameter => bindingNames(ts, parameter.name).includes(name))
      || (ts.isFunctionExpression(at) && at.name?.text === name))) return true;
    if (ts.isCatchClause(at) && at.variableDeclaration && bindingNames(ts, at.variableDeclaration.name).includes(name)) return true;
    const statements = ts.isBlock(at) ? at.statements : [];
    for (const statement of statements) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return true;
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => bindingNames(ts, declaration.name).includes(name))) return true;
    }
    if ((ts.isForStatement(at) || ts.isForOfStatement(at) || ts.isForInStatement(at)) && at.initializer && ts.isVariableDeclarationList(at.initializer)
      && at.initializer.declarations.some(declaration => bindingNames(ts, declaration.name).includes(name))) return true;
  }
  return false;
}

function isMap(ts, node) {
  if (!ts.isCallExpression(node)) return false;
  return ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text === 'map'
    : ts.isElementAccessExpression(node.expression) && ts.isStringLiteralLike(node.expression.argumentExpression) && node.expression.argumentExpression.text === 'map';
}

function callbackArgument(ts, node) {
  let expression = node;
  while (expression.parent && ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
  return isMap(ts, expression.parent) && expression.parent.arguments[0] === expression;
}

function inlineRenderCallback(ts, node) {
  let expression = node;
  while (expression.parent && ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
  if (!expression.parent || !ts.isJsxExpression(expression.parent)) return false;
  const container = expression.parent.parent;
  if (ts.isJsxElement(container) || ts.isJsxFragment(container)) return true;
  return ts.isJsxAttribute(container) && /^(?:children|render[A-Z].*|.*Renderer)$/.test(container.name.getText());
}

/** Resolve same-file callback aliases before walking buttons: ancestry alone misses rows.map(renderRow). */
function collectionCallbacks(ts, source) {
  const definitions = new Map();
  const callbacks = [];
  const collect = node => {
    if (isMap(ts, node) && node.arguments[0]) callbacks.push(node.arguments[0]);
    const name = (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name;
    if (name && ts.isIdentifier(name)) definitions.set(name.text, [...(definitions.get(name.text) ?? []), ts.isVariableDeclaration(node) ? node.initializer : node]);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const owners = new Set();
  const seen = new Set();
  const resolve = node => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) owners.add(node);
    else if (ts.isIdentifier(node)) for (const definition of definitions.get(node.text) ?? []) resolve(definition);
    else if (ts.isParenthesizedExpression(node)) resolve(node.expression);
    else if (ts.isPropertyAccessExpression(node)) for (const definition of definitions.get(node.name.text) ?? []) resolve(definition);
    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'bind') resolve(node.expression.expression);
  };
  for (const callback of callbacks) resolve(callback);
  return owners;
}

function renderOwner(ts, node, source) {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isArrowFunction(at) || ts.isFunctionExpression(at) || ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) {
      // Collection and JSX render callbacks belong to their enclosing component's render, including nested SlotView children.
      if (callbackArgument(ts, at) || inlineRenderCallback(ts, at)) continue;
      return at;
    }
  }
  return source;
}

function inMap(ts, node, owner) {
  for (let at = node.parent; at && at !== owner; at = at.parent) {
    if (isMap(ts, at)) return true;
  }
  return false;
}

function siblingGroup(ts, node, owner) {
  for (let at = node.parent; at && at !== owner; at = at.parent) {
    if (ts.isJsxElement(at) || ts.isJsxFragment(at)) return at;
  }
  return owner;
}

function stableName(ts, node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && stableName(ts, node.expression)) return `${stableName(ts, node.expression)}.${node.name.text}`;
  return null;
}

function conditionFact(ts, expression, choice) {
  if (ts.isParenthesizedExpression(expression)) return conditionFact(ts, expression.expression, choice);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) return conditionFact(ts, expression.operand, !choice);
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    const equality = operator === ts.SyntaxKind.EqualsEqualsEqualsToken;
    const inequality = operator === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    if (!equality && !inequality) return null;
    const name = stableName(ts, expression.left);
    const value = expression.right;
    if (name && (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(value.kind))) {
      const canonical = ts.isStringLiteralLike(value) ? `string:${value.text}` : ts.isNumericLiteral(value) ? `number:${Number(value.text)}` : value.getText();
      return { name, value: canonical, equal: equality === choice };
    }
  }
  const name = stableName(ts, expression);
  return name ? { name, value: 'truthy', equal: choice } : null;
}

function branchChoices(ts, node, owner) {
  const choices = new Map();
  const facts = [];
  const record = (branch, expression, choice) => {
    choices.set(branch, choice);
    const fact = conditionFact(ts, expression, choice);
    if (fact) facts.push(fact);
  };
  for (let at = node; at.parent && at.parent !== owner; at = at.parent) {
    const parent = at.parent;
    if (ts.isConditionalExpression(parent)) {
      if (at === parent.whenTrue) record(parent, parent.condition, true);
      if (at === parent.whenFalse) record(parent, parent.condition, false);
    }
    if (ts.isIfStatement(parent)) {
      if (at === parent.thenStatement) record(parent, parent.expression, true);
      if (at === parent.elseStatement) record(parent, parent.expression, false);
    }
    if (ts.isBinaryExpression(parent) && at === parent.right) {
      if (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) record(parent, parent.left, true);
      if (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) record(parent, parent.left, false);
    }
  }
  return { choices, facts };
}

function canCoexist(first, second) {
  for (const [branch, choice] of first.branches) if (second.branches.has(branch) && second.branches.get(branch) !== choice) return false;
  for (const left of first.facts) for (const right of second.facts) {
    if (left.name !== right.name) continue;
    if (left.value === right.value && left.equal !== right.equal) return false;
    if (left.equal && right.equal && left.value !== right.value && left.value !== 'truthy' && right.value !== 'truthy') return false;
  }
  return true;
}

function destructiveSignal(text) {
  const words = text.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('\u0111', 'd').replaceAll('\u0110', 'D')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return /\b(delete|remove|revoke|discard|destroy|purge|trash|terminate|clear|erase|reset|reject|decline|xoa)\b|\bthu[\s_-]*hoi\b|\b(?:cancel|huy)[\s_-]+(?:offer|booking|appointment|order|subscription|lich|don|de\s+nghi)\b/.test(words);
}

function describe(ts, source, opening, imports, callbacks) {
  const props = attributes(ts, opening);
  const element = ts.isJsxOpeningElement(opening) ? opening.parent : opening;
  const owner = renderOwner(ts, element, source);
  const variant = literal(ts, props.get('variant'));
  const intent = literal(ts, props.get('intent'));
  const branch = branchChoices(ts, element, owner);
  return { opening, element, owner, props, variant, intent, branches: branch.choices, facts: branch.facts,
    group: siblingGroup(ts, element, owner), mapped: variant === 'secondary' ? null : VARIANTS[variant],
    repeated: callbacks.has(owner) || inMap(ts, element, owner), shadowed: shadowedBinding(ts, opening), name: opening.tagName.getText(source), imports };
}

/** Migrate imported Grammar buttons using source edits; ambiguous buttons retain their original props and gain a report finding. */
export function transformButtonIntent({ ts, text, file = 'component.tsx' }) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX);
  const imports = buttonImports(ts, source);
  const callbacks = collectionCallbacks(ts, source);
  const buttons = [];
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isButton(ts, node, imports)) buttons.push(describe(ts, source, node, imports, callbacks));
    ts.forEachChild(node, visit);
  };
  visit(source);
  const findings = [];
  const changes = [];
  const edits = [];
  const flag = (button, code, reason) => findings.push({ file, ...sourceLocation(source, button.opening), code, reason,
    component: button.name, variant: button.variant, source: button.element.getText(source) });
  if (source.parseDiagnostics.length) {
    return { text, changes, findings: [{ file, line: 1, column: 1, code: 'parse-error', reason: ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, '\n') }] };
  }
  const commits = buttons.filter(button => button.variant === 'primary' || button.intent === 'commit');
  for (const button of buttons) {
    if (button.shadowed) {
      flag(button, 'shadowed-button-binding', 'A local binding shadows the Grammar import; inspect its actual component before migrating.');
      continue;
    }
    const pending = [];
    if (button.intent === 'commit' || button.variant === 'primary') {
      if (button.repeated) pending.push(['commit-in-collection', 'A repeated item needs a human choice of alternative or neutral.']);
      if (commits.some(other => other !== button && other.owner === button.owner && canCoexist(button, other))) pending.push(['multiple-commits', 'More than one commit can render in this component; choose the decision owner and next action.']);
    }
    if (button.props.has('intent') && !button.props.has('variant')) {
      for (const [code, reason] of pending) flag(button, code, reason);
      continue;
    }
    if (button.props.has('intent')) pending.push(['intent-and-variant', 'Existing intent and variant need a human reconciliation.']);
    if (!button.props.has('variant')) pending.push(['missing-variant', 'No old variant declares the command role; choose its consequence and rank.']);
    else if (button.variant === null) pending.push(['dynamic-variant', 'A dynamic variant needs a human intent for every branch.']);
    else if (button.variant !== 'secondary' && !button.mapped) pending.push(['unknown-variant', 'This variant has no published mechanical intent mapping.']);
    if (button.opening.attributes.properties.some(ts.isJsxSpreadAttribute)) pending.push(['spread-props', 'Spread props can supply or override intent, step or variant; inspect the source.']);
    if (WEAK.has(button.variant) && destructiveSignal(button.element.getText(source))) pending.push(['destructive-verb', 'A destructive or negative command on a weak variant needs its actual consequence and confirmation step reviewed.']);
    if (button.props.has('step')) pending.push(['existing-step', 'An existing destructive step needs reconciliation with the migrated intent.']);
    if (pending.length) {
      for (const [code, reason] of pending) flag(button, code, reason);
      continue;
    }
    const intent = button.variant === 'secondary'
      ? commits.some(other => other.group === button.group && canCoexist(button, other)) ? 'alternative' : 'neutral'
      : button.mapped;
    const step = button.variant === 'danger' ? 'confirm' : button.variant === 'danger-soft' ? 'entry' : null;
    const attribute = button.props.get('variant');
    const replacement = `intent="${intent}"${step ? ` step="${step}"` : ''}`;
    edits.push({ start: attribute.getStart(source), end: attribute.end, replacement });
    changes.push({ file, ...sourceLocation(source, button.opening), component: button.name, from: button.variant, intent, ...(step ? { step } : {}) });
  }
  let output = text;
  for (const edit of edits.sort((first, second) => second.start - first.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  return { text: output, changes, findings };
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : sourceFiles(target);
    return entry.isFile() && /\.[jt]sx$/i.test(entry.name) ? [target] : [];
  }).sort();
}

/** Preview or apply safe migrations in one app's FE tree; every unresolved case is retained in the returned report. */
export function migrateButtonIntent({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT) }) {
  if (!ts) throw new Error('button-intent needs TypeScript installed in the app or @starci/hfs development checkout');
  const frontend = path.join(root, 'fe');
  if (!fs.statSync(frontend, { throwIfNoEntry: false })?.isDirectory()) throw new Error('button-intent runs at an app root with a fe/ directory');
  const report = { schema: 'starci/button-intent-codemod@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [] };
  for (const target of sourceFiles(frontend)) {
    const file = path.relative(root, target).split(path.sep).join('/');
    const original = fs.readFileSync(target, 'utf8');
    const result = transformButtonIntent({ ts, text: original, file });
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

const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and human decision list as Markdown; JSON consumers use the same unabridged report object. */
export function buttonIntentMarkdown(report) {
  const lines = ['# Button intent migration', '', `${report.write ? 'Applied' : 'Dry run'}: ${report.changes.length} safe changes in ${report.filesChanged.length} files; ${report.findings.length} unresolved findings.`, '',
    '## Safe changes', '', '| Location | Before | Intent | Step |', '| --- | --- | --- | --- |',
    ...report.changes.map(change => `| ${cell(`${change.file}:${change.line}:${change.column}`)} | ${change.from} | ${change.intent} | ${change.step ?? ''} |`), '',
    '## Human decisions', '', '| Location | Code | Reason |', '| --- | --- | --- |',
    ...report.findings.map(finding => `| ${cell(`${finding.file}:${finding.line}:${finding.column}`)} | ${finding.code} | ${cell(finding.reason)} |`), ''];
  return lines.join('\n');
}

function parse(argv) {
  const [name, ...rest] = argv;
  if (name !== 'button-intent') throw new Error('starci app codemod takes button-intent');
  const options = { write: false, format: 'markdown' };
  const args = rest.values();
  for (const arg of args) {
    const [flag, inline] = arg.split(/=(.*)/s);
    if (flag === '--write' || flag === '--json') {
      if (inline !== undefined && !['true', 'false'].includes(inline)) throw new Error(`${flag} expects true or false`);
      const value = inline === undefined || inline === 'true';
      if (flag === '--write') options.write = value;
      else if (value) options.format = 'json';
    } else if (flag === '--format' || flag === '--report') {
      const value = inline ?? args.next().value;
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      options[flag.slice(2)] = value;
    } else throw new Error(`unknown codemod option ${arg}`);
  }
  if (!['json', 'markdown'].includes(options.format)) throw new Error('--format accepts json or markdown');
  return options;
}

/** CLI boundary: dry-run by default, --write mutates only safe FE source; findings return exit 1 with a complete report. */
export function codemodMain(argv, { cwd, stdout }) {
  const options = parse(argv);
  if (options.report && !/\.(?:json|md)$/i.test(options.report)) throw new Error('--report needs a .json or .md report file');
  const report = migrateButtonIntent({ root: path.resolve(cwd), write: options.write });
  const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : buttonIntentMarkdown(report);
  if (options.report) {
    const target = path.resolve(cwd, options.report);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
  }
  stdout(output);
  return report.findings.length ? 1 : 0;
}
