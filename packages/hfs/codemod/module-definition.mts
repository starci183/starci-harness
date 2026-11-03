import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import type { Prettier } from '../sync/format.mjs';
import { formatted, prettierOf } from './app-prettier.mjs';
import { filesUnder, relativePosix, sideFolders } from './source-tree.mjs';
import type * as TsTypes from 'typescript';

/** The TypeScript compiler API of the app's own install (loadTypescript), typed by the version this package develops against. */
type Ts = typeof import('typescript');

/** One definition the migration rewrites: which form it was written in, the helper it became and the names it exports. */
export interface ModuleDefinitionChange { file: string; from: 'destructured builder' | 'typed builder'; helper: string; names: string[] }
/** One case left for a person. */
export interface ModuleDefinitionFinding { file: string; line: number; code: string; reason: string }
/** The report of a migration (`starci app codemod module-definition`). */
export interface ModuleDefinitionReport {
  schema: string; root: string; write: boolean; filesScanned: number; filesChanged: string[]; changes: ModuleDefinitionChange[]; findings: ModuleDefinitionFinding[];
  /** The `@starci/nest-kit` requirement of the app's root package.json: added by `--execute` when a definition changed, then `npm install` resolves it. */
  dependency: { name: string; version: string; declared: boolean; added: boolean };
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT = '@starci/nest-kit';
const DEFINITION_FILE = /\.module-definition\.tsx?$/;
const EXPORTED = new Set(['ConfigurableModuleClass', 'MODULE_OPTIONS_TOKEN', 'OPTIONS_TYPE', 'ASYNC_OPTIONS_TYPE']);
const PRINT_WIDTH = 120;

/** What one definition file says: the options type, the builder arguments, the chain's calls and the names it exports. */
interface Reading {
  options: string;
  token: string | null;
  representative: boolean;
  names: string[];
  doc: string;
  /** Statements the new text drops, and the one the new export takes the place of. */
  drop: Set<TsTypes.Statement>;
  at: TsTypes.Statement;
  from: ModuleDefinitionChange['from'];
}

/** A reason the file is left for a person, or a reading. */
type Outcome = Reading | { reason: string; code: string; line: number } | null;

const unfit = (source: TsTypes.SourceFile, node: TsTypes.Node, code: string, reason: string): { reason: string; code: string; line: number } => ({ reason, code, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });

/** The builder expression `new ConfigurableModuleBuilder<X>(args).call().call()...` unwrapped to its `new` and the calls on it, in order; null when `expression` is not one. */
function builderOf(ts: Ts, expression: TsTypes.Expression): { created: TsTypes.NewExpression; calls: { name: string; call: TsTypes.CallExpression }[] } | null {
  const calls: { name: string; call: TsTypes.CallExpression }[] = [];
  let node: TsTypes.Expression = expression;
  while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    calls.unshift({ name: node.expression.name.text, call: node });
    node = node.expression.expression;
  }
  return ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ConfigurableModuleBuilder' ? { created: node, calls } : null;
}

/** The text of a statement's own JSDoc comment (without the delimiters), or an empty string. */
function docOf(ts: Ts, source: TsTypes.SourceFile, statement: TsTypes.Node): string {
  const ranges = ts.getLeadingCommentRanges(source.text, statement.pos) ?? [];
  const last = ranges.at(-1);
  const text = last === undefined ? '' : source.text.slice(last.pos, last.end);
  return text.startsWith('/**') ? text.slice(3, -2).replace(/^\s*\*\s?/gm, '').trim() : '';
}

/** Reads the builder part of a definition: options type, token, representative or not; a reason when the chain is not one the helpers stand for. */
function readBuilder(ts: Ts, source: TsTypes.SourceFile, node: TsTypes.Expression): { options: string; token: string | null; representative: boolean } | { reason: string; code: string; line: number } {
  const built = builderOf(ts, node);
  if (built === null) return unfit(source, node, 'MODULE_DEFINITION_NOT_A_BUILDER', 'the definition is not `new ConfigurableModuleBuilder<XOptions>(...)` with its calls and `.build()`');
  const { created, calls } = built;
  const options = created.typeArguments?.[0];
  if (options === undefined) return unfit(source, created, 'MODULE_DEFINITION_UNTYPED', 'the builder states no options type; write `ConfigurableModuleBuilder<XOptions>` and run the codemod again');
  let token: string | null = null;
  const argument = created.arguments?.[0];
  if (argument !== undefined) {
    const only = ts.isObjectLiteralExpression(argument) && argument.properties.length === 1 ? argument.properties[0] : undefined;
    if (only === undefined || !ts.isPropertyAssignment(only) || !ts.isIdentifier(only.name) || only.name.text !== 'optionsInjectionToken' || !ts.isIdentifier(only.initializer)) {
      return unfit(source, argument, 'MODULE_DEFINITION_BUILDER_OPTIONS', 'the helpers take `optionsInjectionToken` as an identifier and no other builder setting; keep this definition and ask for the setting in @starci/nest-kit');
    }
    token = only.initializer.text;
  }
  const names = calls.map((entry) => entry.name);
  if (names.at(-1) !== 'build') return unfit(source, node, 'MODULE_DEFINITION_NOT_BUILT', 'the chain does not end in `.build()`');
  const extra = names.filter((name) => name !== 'build' && name !== 'setExtras' && name !== 'setClassMethodName');
  if (extra.length > 0) return unfit(source, node, 'MODULE_DEFINITION_CHAIN', `\`.${extra[0] as string}(...)\` has no helper; the helpers define \`register\` (and \`isGlobal\` for a capability) only`);
  const named = calls.find((entry) => entry.name === 'setClassMethodName');
  const method = named?.call.arguments[0];
  if (method !== undefined && !(ts.isStringLiteral(method) && method.text === 'register')) return unfit(source, method, 'MODULE_DEFINITION_CHAIN', 'the class method is not "register"; static-module-register allows `register` only');
  const extras = calls.find((entry) => entry.name === 'setExtras');
  if (extras !== undefined) {
    const defaults = extras.call.arguments[0];
    const standard = defaults !== undefined && ts.isObjectLiteralExpression(defaults) && defaults.properties.length === 1
      && ts.isPropertyAssignment(defaults.properties[0] as TsTypes.ObjectLiteralElementLike) && (defaults.properties[0] as TsTypes.PropertyAssignment).initializer.kind === ts.SyntaxKind.FalseKeyword
      && (defaults.properties[0] as TsTypes.PropertyAssignment).name.getText(source) === 'isGlobal';
    if (!standard) return unfit(source, extras.call, 'MODULE_DEFINITION_CHAIN', 'the extras are not `{ isGlobal: false }`; the capability helper is the one standard shape');
  }
  return { options: options.getText(source), token, representative: extras !== undefined };
}

/** The reading of one definition file, in either written form, or why it is left alone (null: no definition here, nothing to do). */
function readDefinition(ts: Ts, source: TsTypes.SourceFile): Outcome {
  const statements = [...source.statements];
  // The destructured form: `export const { A, B } = new ConfigurableModuleBuilder<X>()....build()`.
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const declaration = statement.declarationList.declarations[0];
    if (declaration === undefined || !ts.isObjectBindingPattern(declaration.name) || declaration.initializer === undefined || builderOf(ts, declaration.initializer) === null) continue;
    const read = readBuilder(ts, source, declaration.initializer);
    if ('reason' in read) return read;
    const names: string[] = [];
    for (const element of declaration.name.elements) {
      if (!ts.isIdentifier(element.name) || element.propertyName !== undefined || element.dotDotDotToken !== undefined || !EXPORTED.has(element.name.text)) return unfit(source, element, 'MODULE_DEFINITION_NAMES', 'a name is renamed, spread or not one of ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE');
      names.push(element.name.text);
    }
    return { ...read, names, doc: docOf(ts, source, statement), drop: new Set(), at: statement, from: 'destructured builder' };
  }
  // The typed form: `const built = new ConfigurableModuleBuilder<X>()....build()`, `type Host = ConfigurableModuleHost<...>`, `export const A: Host["A"] = built.A`.
  const builtStatement = statements.find((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.initializer !== undefined && builderOf(ts, declaration.initializer) !== null));
  if (builtStatement === undefined || !ts.isVariableStatement(builtStatement)) return null;
  const declaration = builtStatement.declarationList.declarations[0] as TsTypes.VariableDeclaration;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return unfit(source, builtStatement, 'MODULE_DEFINITION_NOT_A_BUILDER', 'the builder is not bound to one name');
  const read = readBuilder(ts, source, declaration.initializer);
  if ('reason' in read) return read;
  const local = declaration.name.text;
  const drop = new Set<TsTypes.Statement>([builtStatement]);
  const names: string[] = [];
  let doc = '';
  let at: TsTypes.Statement | null = null;
  for (const statement of statements) {
    if (ts.isTypeAliasDeclaration(statement) && ts.isTypeReferenceNode(statement.type) && ts.isIdentifier(statement.type.typeName) && statement.type.typeName.text === 'ConfigurableModuleHost') {
      drop.add(statement);
      continue;
    }
    if (!ts.isVariableStatement(statement) || statement === builtStatement) continue;
    const exported = statement.declarationList.declarations[0];
    const initializer = exported?.initializer;
    const typed = initializer !== undefined && ts.isPropertyAccessExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === local && ts.isIdentifier(initializer.name);
    if (exported === undefined || !typed || !ts.isIdentifier(exported.name) || initializer.name.text !== exported.name.text || !EXPORTED.has(exported.name.text)) continue;
    names.push(exported.name.text);
    drop.add(statement);
    if (at === null) { at = statement; doc = docOf(ts, source, statement) || docOf(ts, source, builtStatement); }
  }
  if (at === null || names.length === 0) return unfit(source, builtStatement, 'MODULE_DEFINITION_NAMES', 'the built definition is not re-exported by name (`export const ConfigurableModuleClass: Host["ConfigurableModuleClass"] = built.ConfigurableModuleClass`)');
  drop.delete(at);
  // Anything else that still reads `built` or `Host` would break once they are gone.
  const stillUsed = statements.some((statement) => !drop.has(statement) && statement !== at && !ts.isImportDeclaration(statement) && /\b(?:built|Host)\b/.test(statement.getText(source)));
  if (stillUsed) return unfit(source, builtStatement, 'MODULE_DEFINITION_NAMES', 'another statement of the file reads the builder result or `Host`');
  return { ...read, names: [...names].sort((a, b) => [...EXPORTED].indexOf(a) - [...EXPORTED].indexOf(b)), doc, drop, at, from: 'typed builder' };
}

/** The one export of the new definition, laid out the way Prettier prints it at the width of the canon (one line; else the options object opens on the line of the `=` when that fits; else the call breaks after the `=`). */
function exportLine(reading: Reading, helper: string): string {
  const head = `export const { ${reading.names.join(', ')} } =`;
  const call = `${helper}<${reading.options}>(${reading.token === null ? '' : `{ optionsInjectionToken: ${reading.token} }`})`;
  if (`${head} ${call}`.length <= PRINT_WIDTH) return `${head} ${call}`;
  const hug = `${head} ${helper}<${reading.options}>({`;
  return reading.token !== null && hug.length <= PRINT_WIDTH ? `${hug}\n    optionsInjectionToken: ${reading.token},\n})` : `${head}\n    ${call}`;
}

/** The words of `text` (identifier characters), so a binding is known to be read by its name. */
const wordsOf = (text: string): ReadonlySet<string> => new Set(text.match(/[\w$]+/g));

/**
 * An import declaration without the named bindings the rewrite made unused (read by the dropped statements, by none of the kept ones), or null
 * when nothing is left of it; `import type` and inline `type` stay as written.
 */
function prunedImport(ts: Ts, source: TsTypes.SourceFile, statement: TsTypes.ImportDeclaration, before: ReadonlySet<string>, after: ReadonlySet<string>): string | null {
  const clause = statement.importClause;
  const bindings = clause?.namedBindings;
  if (clause === undefined || bindings === undefined || !ts.isNamedImports(bindings)) return statement.getText(source);
  const kept = bindings.elements.filter((element) => after.has(element.name.text) || !before.has(element.name.text));
  if (kept.length === bindings.elements.length) return statement.getText(source);
  if (kept.length === 0 && clause.name === undefined) return null;
  const named = kept.length === 0 ? '' : `{ ${kept.map((element) => element.getText(source)).join(', ')} }`;
  const head = [clause.name?.text, named].filter((part) => part !== undefined && part !== '').join(', ');
  return `import ${clause.isTypeOnly ? 'type ' : ''}${head} from ${statement.moduleSpecifier.getText(source)}`;
}

/** Rewrite one definition file's text to the helper form; `text` unchanged when the file holds no definition the codemod can rewrite. */
export function transformModuleDefinition({ ts, text, file = 'x.module-definition.ts' }: { ts: Ts; text: string; file?: string }): { text: string; changes: ModuleDefinitionChange[]; findings: ModuleDefinitionFinding[] } {
  const none = { text, changes: [], findings: [] };
  if (!text.includes('ConfigurableModuleBuilder')) return none;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const read = readDefinition(ts, source);
  if (read === null) return none;
  if ('reason' in read) return { ...none, findings: [{ file, line: read.line, code: read.code, reason: read.reason }] };
  const helper = read.representative ? 'defineCapabilityModule' : 'defineConfigurableModule';
  const body: string[] = [];
  const declarations: TsTypes.ImportDeclaration[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      declarations.push(statement);
      continue;
    }
    if (read.drop.has(statement)) continue;
    if (statement === read.at) {
      body.push(`${read.doc === '' ? '' : `/** ${read.doc} */\n`}${exportLine(read, helper)}`);
      continue;
    }
    body.push(text.slice(statement.pos, statement.end).replace(/^\s*\n/, '').trimEnd());
  }
  const before = wordsOf(source.statements.filter((statement) => !ts.isImportDeclaration(statement)).map((statement) => statement.getText(source)).join('\n'));
  const after = wordsOf(body.join('\n'));
  const imports = [`import { ${helper} } from "${KIT}"`, ...declarations.flatMap((statement) => prunedImport(ts, source, statement, before, after) ?? [])];
  const output = `${imports.join('\n')}\n\n${body.join('\n\n')}\n`;
  return { text: output, changes: [{ file, from: read.from, helper, names: read.names }], findings: [] };
}

/** The `@starci/nest-kit` requirement the codemod adds to an app's root package.json. */
function kitVersion(): string {
  return bundledPins()[KIT]?.version ?? '0.1.0';
}

/** What `migrateModuleDefinition` takes: the app root, whether to write, and the compiler and formatter of the app (found in it when left out; `prettier: null` writes the codemod's own layout). */
export interface ModuleDefinitionOptions { root: string; write?: boolean; ts?: Ts | null; prettier?: Prettier | null }

/**
 * Preview or apply the rewrite in one app: every `*.module-definition.ts` under its sides, each rewritten file formatted by the app's Prettier
 * (so `app check --format` and the app's hook accept it as written), then the dependency in the root package.json.
 */
export async function migrateModuleDefinition({ root, write = false, ts = loadTypescript(root, PACKAGE_ROOT), prettier }: ModuleDefinitionOptions): Promise<ModuleDefinitionReport> {
  if (!ts) throw new Error('module-definition needs TypeScript installed in the app or @starci/hfs development checkout');
  const folders = sideFolders(root);
  if (!folders.length) throw new Error('module-definition runs at an app root with a be/ directory');
  const formatter = prettier === undefined ? prettierOf(root, folders) : prettier ?? undefined;
  const packageFile = path.join(root, 'package.json');
  const manifest = fs.existsSync(packageFile) ? JSON.parse(fs.readFileSync(packageFile, 'utf8')) as { dependencies?: Record<string, string> } : null; // reason: package.json parsed from disk, only dependencies is read
  const declared = manifest?.dependencies?.[KIT] !== undefined;
  const report: ModuleDefinitionReport = { schema: 'starci/module-definition-report@1', root, write, filesScanned: 0, filesChanged: [], changes: [], findings: [], dependency: { name: KIT, version: kitVersion(), declared, added: false } };
  for (const target of folders.flatMap((folder) => filesUnder(folder, DEFINITION_FILE))) {
    const file = relativePosix(root, target);
    const original = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const result = transformModuleDefinition({ ts, text: original, file });
    report.filesScanned += 1;
    report.changes.push(...result.changes);
    report.findings.push(...result.findings);
    if (result.text !== original) {
      report.filesChanged.push(file);
      if (write) fs.writeFileSync(target, formatter === undefined ? result.text : await formatted(formatter, root, target, result.text));
    }
  }
  if (report.filesChanged.length > 0 && !declared && manifest !== null) {
    report.dependency.added = write;
    if (write) {
      manifest.dependencies = Object.fromEntries(Object.entries({ ...manifest.dependencies, [KIT]: report.dependency.version }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      fs.writeFileSync(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the rewrite and what is left for a person as Markdown; JSON consumers read the same report object. */
export function moduleDefinitionMarkdown(report: ModuleDefinitionReport): string {
  const out = ['# module-definition', '', `Scanned ${report.filesScanned} definitions, ${report.filesChanged.length} ${report.write ? 'rewritten' : 'would be rewritten'}, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| location | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(`${finding.file}:${finding.line}`)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.changes.length) {
    out.push('## Rewritten', '', '| file | from | helper | names |', '|---|---|---|---|');
    for (const item of report.changes) out.push(`| ${cell(item.file)} | ${item.from} | ${item.helper} | ${cell(item.names.join(', '))} |`);
    out.push('');
  }
  if (report.filesChanged.length > 0 && !report.dependency.declared) {
    out.push('## Dependency', '', report.dependency.added ? `\`${KIT}@${report.dependency.version}\` was added to package.json: run \`npm install\`.` : `\`${KIT}@${report.dependency.version}\` is added to package.json by \`--execute\`; then run \`npm install\`.`, '');
  }
  return `${out.join('\n')}\n`;
}
