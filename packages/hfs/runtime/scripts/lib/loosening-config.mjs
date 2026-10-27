// loosening-config.mjs - reads the gate configuration files of a tree as the lists and numbers that could relax a gate.
// A config file is one of a fixed set of kinds (codecov, sonar, jest, eslint, stylelint, tsconfig, ignore file, stack declaration, hfs declaration,
// exception file); for each, this module returns what the file states, as plain records, and judges nothing: scripts/lib/loosening-state.mjs
// compares the records with the canon and the design-truths manifest. YAML is parsed (anchors, flow style and quoted keys resolve), a
// .properties file is read by the Java rules (continuations; =, : or a blank as the separator), a tsconfig is found by its content.
//   lists      { list, key, item, line }   an entry of an ignore or exclude list; `list` is the class the manifest allows entries by
//   numbers    { key, value, line }        a coverage target or threshold
//   settings   { key, value, line }        a yes/no switch that can relax a gate
//   rulesOff   { rule, line }              an ESLint or stylelint rule turned off or down
//   strictness { key, value, line }        a tsconfig strictness option turned off, or a type-check skip turned on
//   budgets    { key, line }               a numeric budget a config states itself (the canon owns every budget)
//   scope      { key, line }               a key that narrows what a tool reads or runs (the canon configs state none)
import { parseYaml } from '../../engine/yaml.mjs';
import { langOf, lexSource, splitLines } from './js-lex.mjs';
import { splitList } from './list.mjs';

export const LIST = Object.freeze({
  coverage: 'coverage-exclusions',
  sonar: 'sonar-exclusions',
  cpd: 'cpd-exclusions',
  scope: 'sonar-scope',
  paths: 'path-ignores',
  jest: 'jest-patterns',
  issues: 'issue-ignores',
});

const JEST_PRESET = 'packages/jest-preset/index.cjs';
const KINDS = [
  ['codecov', /(?:^|\/)\.?codecov\.ya?ml$/],
  ['sonar', /(?:^|\/)sonar[\w.-]*\.properties$/],
  ['jest', /(?:^|\/)jest\.config\.(?:[cm]?[jt]s|json)$|^packages\/jest-preset\/index\.cjs$/],
  ['eslint', /(?:^|\/)(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.\w+)?)$|^packages\/eslint\/[^/]+\/lib\/config\.mjs$/],
  ['stylelint', /(?:^|\/)(?:stylelint\.config\.[cm]?[jt]s|\.stylelintrc(?:\.\w+)?)$/],
  ['tsconfig', /(?:^|\/)tsconfig[\w.-]*\.json$|^packages\/tsconfig\/[\w-]+\.json$/],
  ['ignorefile', /(?:^|\/)\.?(?:prettier|eslint|stylelint)ignore$/],
  ['stack', /(?:^|\/)application-stacks\.ya?ml$/],
  ['declaration', /(?:^|\/)hfs\.json$/],
];

/** The kind of gate configuration `file` is, or null. A JSON file that holds compilerOptions is a tsconfig whatever it is called (it may be extended). */
export function configKindOf(file, text = '') {
  const named = KINDS.find(([, pattern]) => pattern.test(file))?.[0];
  if (named) return named;
  return file.endsWith('.json') && !file.endsWith('package.json') && /"compilerOptions"\s*:/.test(text) ? 'tsconfig' : null;
}

/** Whether `file` may be a tsconfig by its extension: the check has to read it to know. */
export const maybeTsconfig = (file) => file.endsWith('.json') && !file.endsWith('package.json') && !file.endsWith('package-lock.json');

const EXCEPTION_WORDS = new Set(['allowlist', 'approval', 'approvals', 'exception', 'exceptions', 'exempt', 'exemption', 'exemptions', 'waiver', 'waivers',
  'suppression', 'suppressions', 'baseline', 'accepted', 'permit', 'permits', 'ignored', 'skiplist']);
const EXCEPTION_PAIRS = ['allow-list', 'known-issues', 'known-findings', 'ignore-list', 'skip-list', 'accepted-risk', 'accepted-risks'];
const EXCEPTION_EXTENSIONS = ['.yaml', '.yml', '.json', '.txt', '.csv'];

/** Files whose name says, anywhere in it, that they hold exceptions, approvals or a baseline of findings; a schema file only describes one. */
export function isExceptionFile(file) {
  const base = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  const extension = EXCEPTION_EXTENSIONS.find((suffix) => base.endsWith(suffix));
  if (!extension) return false;
  const stem = base.slice(0, -extension.length);
  if (stem.endsWith('.schema')) return false;
  return stem.split(/[._-]/).some((word) => EXCEPTION_WORDS.has(word)) || EXCEPTION_PAIRS.some((pair) => stem.includes(pair));
}

const METADATA_KEYS = new Set(['schema', 'version', 'id', 'title', 'purpose', 'description']);

/** The entries a parsed exception document holds: the size of every array or map section, one for any other value. */
function sectionSize(value) {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === 'object') return Object.keys(value).length;
  return value === null || value === undefined || value === '' ? 0 : 1;
}

/** How many entries an exception file holds (parsed: a flow-style list counts like a block-style one; a text list counts its lines). */
export function exceptionEntries(file, text) {
  if (/\.(?:ya?ml|json)$/i.test(file)) {
    let doc;
    try { doc = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text); } catch { return 1; }
    if (Array.isArray(doc)) return doc.length;
    return Object.entries(doc ?? {}).filter(([key]) => !METADATA_KEYS.has(key)).reduce((sum, [, value]) => sum + sectionSize(value), 0);
  }
  return splitLines(text).filter((line) => line.trim() && !line.trimStart().startsWith('#')).length;
}

const PLACEHOLDER = /\{\{|\}\}/;
const record = (list, key, item, line) => ({ list, key, item: String(item).trim(), line });
const unquote = (value) => String(value).trim().replace(/^["']|["']$/g, '');
const lineOfText = (text, needle) => Math.max(1, splitLines(text).findIndex((line) => line.includes(needle)) + 1);

/** A .properties file as [{key, value, line}]: logical lines (a trailing backslash continues), key and value split at the first =, : or blank. */
function propertyRows(text) {
  const rows = [];
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    let logical = lines[index];
    const line = index + 1;
    while (/(?:^|[^\\])(?:\\\\)*\\$/.test(logical) && index + 1 < lines.length) { logical = `${logical.slice(0, -1)}${lines[index + 1].trimStart()}`; index += 1; }
    const trimmed = logical.trimStart();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const split = trimmed.search(/[=:\s]/);
    if (split < 1) continue;
    rows.push({ key: trimmed.slice(0, split), value: trimmed.slice(split).replace(/^\s*[=:]?\s*/, '').trim(), line });
  }
  return rows;
}

const SONAR_LIST_KEY = /^sonar\.(?:[a-z]+\.)?(?:global\.|test\.|coverage\.|cpd\.)?exclusions$/;
const SONAR_SCOPE_KEYS = new Set(['sonar.inclusions', 'sonar.sources']);

function sonarListOf(key) {
  if (key.includes('coverage.')) return LIST.coverage;
  return key.includes('cpd.') ? LIST.cpd : LIST.sonar;
}

function sonarRecords(text) {
  const lists = [];
  const settings = [];
  for (const { key, value, line } of propertyRows(text)) {
    const kind = SONAR_LIST_KEY.test(key) ? sonarListOf(key) : (SONAR_SCOPE_KEYS.has(key) && LIST.scope);
    if (kind) lists.push(...splitList(value, { sep: ',' }).filter((item) => !PLACEHOLDER.test(item)).map((item) => record(kind, key, item, line)));
    else if (/^sonar\.(?:issue\.(?:ignore|enforce)\.|skip$)/.test(key)) lists.push(record(LIST.issues, key, `${key}=${value}`, line));
    else if (key === 'sonar.qualitygate.wait') settings.push({ key, value, line });
  }
  return { lists, settings };
}

const SETTING_KEYS = new Set(['require_ci_to_pass', 'informational', 'if_ci_failed']);
const percentOf = (value) => (typeof value === 'number' ? value : Number.parseFloat(String(value).replace('%', '')));

/** Every `{key, value}` under a `status` mapping, however deep (anchors and flow style are already resolved by the parser). */
function walkCodecov(node, found, path = []) {
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'target' || key === 'threshold') && (typeof value !== 'object' || value === null)) {
      const number = key === 'target' && String(value).trim() === 'auto' ? 0 : percentOf(value);
      found.numbers.push({ key, value: Number.isNaN(number) ? 0 : number, line: 1 });
    } else if (SETTING_KEYS.has(key)) found.settings.push({ key, value: String(value), line: 1 });
    else if ((key === 'project' || key === 'patch' || key === 'changes') && path.includes('status') && (value === false || String(value) === 'off')) found.settings.push({ key: 'status', value: 'off', line: 1 });
    walkCodecov(value, found, [...path, key]);
  }
}

function codecovParsed(text) {
  const doc = parseYaml(text);
  const found = { lists: [], numbers: [], settings: [] };
  for (const item of Array.isArray(doc?.ignore) ? doc.ignore : []) found.lists.push(record(LIST.coverage, 'ignore', unquote(item), lineOfText(text, String(item))));
  walkCodecov(doc, found);
  return found;
}

function listItemOf(line) {
  const text = line.trim();
  if (!text.startsWith('- ')) return null;
  const note = text.indexOf(' #');
  return (note < 0 ? text : text.slice(0, note)).slice(2).trim() || null;
}

/** The line-shaped reading of a codecov file the YAML parser cannot read (a template with placeholders). */
function codecovLines(text) {
  const lines = splitLines(text);
  const found = { lists: [], numbers: [], settings: [] };
  lines.forEach((raw, index) => {
    const number = /^\s*(target|threshold)\s*:\s*["']?(-?\d+(?:\.\d+)?)%?["']?\s*(?:#.*)?$/.exec(raw);
    if (number) found.numbers.push({ key: number[1], value: Number(number[2]), line: index + 1 });
    const setting = /^\s*(require_ci_to_pass|informational|if_ci_failed)\s*:\s*(\S+)/.exec(raw);
    if (setting) found.settings.push({ key: setting[1], value: unquote(setting[2]), line: index + 1 });
  });
  const start = lines.findIndex((line) => /^ignore\s*:/.test(line));
  for (let at = start + 1; start >= 0 && at < lines.length && !/^\S/.test(lines[at]); at += 1) {
    const item = listItemOf(lines[at]);
    if (item && !PLACEHOLDER.test(item)) found.lists.push(record(LIST.coverage, 'ignore', unquote(item), at + 1));
  }
  return found;
}

/** A YAML anchor or alias outside a comment: the codecov file of the canon states every value itself, so a reused node can hide an entry. */
const ANCHOR_WORD = /^[&*][\w-]+$/;
/** A line without its comment and without what sits in quotes. */
function bareLine(line) {
  let quote = '';
  let out = '';
  for (const char of line) {
    if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === "'") quote = char;
    else if (char === '#') break;
    else out += char;
  }
  return out;
}
const hasAlias = (text) => splitLines(text).some((line) => bareLine(line).split(/[\s[\]{},:]+/).some((word) => ANCHOR_WORD.test(word)));

function codecovRecords(text) {
  const aliased = hasAlias(text) ? [{ key: 'yaml-alias', value: 'true', line: lineOfText(text, '&') }] : [];
  let found;
  try { found = codecovParsed(text); } catch { found = codecovLines(text); }
  return { ...found, settings: [...found.settings, ...aliased] };
}

/** The offsets of the bracket pair that opens at `open` in the blanked `code`. */
function closeOf(code, open) {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === '[') depth += 1;
    else if (code[at] === ']') { depth -= 1; if (depth === 0) return at; }
  }
  return code.length;
}

const ARRAY_START = /[:=(]\s*(?:Object\.freeze\(\s*)?\[/g;
const NAME_CHAR = /[\w$]/;

/** The identifier that ends right before `end` in the blanked `code`, past a closing quote and blanks (a key, a constant or a callee). */
function nameBefore(code, end) {
  let stop = end;
  while (stop > 0 && (code[stop - 1] === ' ' || code[stop - 1] === '\t' || code[stop - 1] === '"' || code[stop - 1] === "'")) stop -= 1;
  let start = stop;
  while (start > 0 && NAME_CHAR.test(code[start - 1])) start -= 1;
  return code.slice(start, stop);
}

/** The string elements of every array a key, a constant or a call named by `accept(name)` holds. */
function arrayItems(lexed, accept) {
  const found = [];
  for (const match of lexed.code.matchAll(ARRAY_START)) {
    const name = nameBefore(lexed.code, match.index);
    if (!name || !accept(name)) continue;
    const open = match.index + match[0].length - 1;
    const close = closeOf(lexed.code, open);
    for (const piece of lexed.strings) if (piece.at > open && piece.at < close) found.push({ name, item: piece.text, line: piece.line });
  }
  return found;
}

const JEST_ARRAYS = new Map([
  ['coveragePathIgnorePatterns', LIST.coverage], ['excludes', LIST.coverage],
  ['testPathIgnorePatterns', LIST.jest], ['modulePathIgnorePatterns', LIST.jest], ['watchPathIgnorePatterns', LIST.jest],
]);
const JEST_SCOPE_KEYS = ['testMatch', 'testRegex', 'roots', 'projects', 'collectCoverageFrom', 'coverageThreshold', 'coverageProvider', 'rootDir', 'testPathPattern'];
const lineAt = (text, index) => splitLines(text.slice(0, index)).length;

/** The ranges of the `coverage: { ... }` objects of a jest config: the rendered coverage options (roots, roles, excludes) are the canon's, not a scope of the run. */
function coverageRanges(code) {
  const ranges = [];
  for (const match of code.matchAll(/\bcoverage\s*:\s*\{/g)) {
    let depth = 0;
    for (let at = match.index + match[0].length - 1; at < code.length; at += 1) {
      if (code[at] === '{') depth += 1;
      else if (code[at] === '}') { depth -= 1; if (depth === 0) { ranges.push([match.index, at]); break; } }
    }
  }
  return ranges;
}

function jestRecords(text, file) {
  const lexed = lexSource(text, langOf(file));
  const source = file.endsWith('.json') ? { ...lexed, code: text, strings: [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => ({ at: m.index + 1, line: lineAt(text, m.index), text: m[1] })) } : lexed;
  const lists = arrayItems(source, (name) => JEST_ARRAYS.has(name)).map((entry) => record(JEST_ARRAYS.get(entry.name), entry.name, entry.item, entry.line));
  const numbers = [...text.matchAll(/["']?\b(lines|branches|functions|statements)\b["']?\s*:\s*(-?\d+(?:\.\d+)?)/g)].map((match) => ({ key: match[1], value: Number(match[2]), line: lineAt(text, match.index) }));
  const settings = [...text.matchAll(/["']?\bpassWithNoTests\b["']?\s*:\s*(true)\b/g)].map((match) => ({ key: 'passWithNoTests', value: match[1], line: lineAt(text, match.index) }));
  const inside = coverageRanges(source.code);
  const scope = file === JEST_PRESET ? [] : JEST_SCOPE_KEYS.flatMap((key) => [...source.code.matchAll(new RegExp(String.raw`["']?\b${key}\b["']?\s*:`, 'g'))]
    .filter((match) => !inside.some(([from, to]) => match.index > from && match.index < to)).map((match) => ({ key, line: lineAt(text, match.index) })));
  return { lists, numbers, settings, scope };
}

const IGNORE_KEYS = new Set(['ignores', 'ignoreFiles', 'ignorePatterns', 'globalIgnores']);
const IGNORE_SUFFIXES = ['IGNORED', 'IGNORES', 'EXCLUDE', 'EXCLUDES'];
const isIgnoreName = (name) => IGNORE_KEYS.has(name) || (name === name.toUpperCase() && (name.startsWith('OUTSIDE_THE_') || IGNORE_SUFFIXES.some((suffix) => name.endsWith(suffix))));
const LEVEL = /["']([@\w/.-]+)["']\s*:\s*(?:["'](?:off|warn)["']|\[\s*["'](?:off|warn)["']|[01])/g;
const NULL_RULE = /["']([@\w/.-]+)["']\s*:\s*null\b/g;
const BUDGET_KEYS = /"(ruleParams|budget|budgets|fileLines|functionLines|featureFiles|duplicateBlock)"\s*:/g;
const LINT_BUDGETS = /["']?(max-lines|max-lines-per-function|max-params|max-depth|max-statements|max-nested-callbacks|complexity)["']?\s*:/g;

/** Every budget key `pattern` finds in `text`, with its line. */
function budgetKeys(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => ({ key: match[1], line: lineAt(text, match.index) }));
}

function lintRecords(text, file, kind) {
  const lexed = lexSource(text, langOf(file));
  const lists = arrayItems(lexed, isIgnoreName).map((entry) => record(LIST.paths, entry.name, entry.item, entry.line));
  const rulesOff = [];
  const pattern = kind === 'eslint' ? LEVEL : NULL_RULE;
  splitLines(text).forEach((line, index) => { for (const match of line.matchAll(pattern)) rulesOff.push({ rule: match[1], line: index + 1 }); });
  return { lists, rulesOff, budgets: kind === 'eslint' ? budgetKeys(text, LINT_BUDGETS) : [] };
}

const STRICT = Object.freeze({
  strict: true, noImplicitAny: true, strictNullChecks: true, strictFunctionTypes: true, strictBindCallApply: true, strictPropertyInitialization: true,
  noImplicitThis: true, useUnknownInCatchVariables: true, alwaysStrict: true, noImplicitOverride: true, noFallthroughCasesInSwitch: true,
  noImplicitReturns: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noUnusedLocals: true, noUnusedParameters: true,
  allowUnusedLabels: false, allowUnreachableCode: false, forceConsistentCasingInFileNames: true,
});
const RELAXING_ON = Object.freeze(['skipLibCheck', 'skipDefaultLibCheck', 'suppressImplicitAnyIndexErrors', 'suppressExcessPropertyErrors', 'noStrictGenericChecks', 'noImplicitUseStrict', 'noCheck']);
const isRelaxed = (key, value) => (Object.hasOwn(STRICT, key) && (value === 'true') !== STRICT[key]) || (RELAXING_ON.includes(key) && value === 'true');

function tsconfigRecords(text) {
  const strictness = [];
  const lists = [];
  splitLines(text).forEach((raw, index) => {
    for (const option of raw.matchAll(/"(\w+)"\s*:\s*(true|false)\b/g)) {
      if (isRelaxed(option[1], option[2])) strictness.push({ key: option[1], value: option[2], line: index + 1 });
    }
  });
  for (const match of text.matchAll(/"exclude"\s*:\s*\[([^\]]*)\]/g)) {
    const line = lineAt(text, match.index);
    for (const item of match[1].matchAll(/"([^"]+)"/g)) lists.push(record(LIST.paths, 'exclude', item[1], line));
  }
  return { lists, strictness };
}

function ignoreFileRecords(text) {
  const lists = [];
  splitLines(text).forEach((raw, index) => {
    const line = raw.trim();
    if (line && !line.startsWith('#') && !line.startsWith('!') && !PLACEHOLDER.test(line)) lists.push(record(LIST.paths, 'ignore', line, index + 1));
  });
  return { lists };
}

function stackRecords(text) {
  const settings = [];
  splitLines(text).forEach((raw, index) => {
    const setting = /^\s*(requireCi)\s*:\s*(true|false)\b/.exec(raw);
    if (setting) settings.push({ key: setting[1], value: setting[2], line: index + 1 });
  });
  return { settings };
}

const EXTRACT = {
  codecov: (text) => codecovRecords(text),
  sonar: (text) => sonarRecords(text),
  jest: jestRecords,
  eslint: (text, file) => lintRecords(text, file, 'eslint'),
  stylelint: (text, file) => lintRecords(text, file, 'stylelint'),
  tsconfig: (text) => tsconfigRecords(text),
  ignorefile: (text) => ignoreFileRecords(text),
  stack: (text) => stackRecords(text),
  declaration: (text) => ({ budgets: budgetKeys(text, BUDGET_KEYS) }),
};

/** What the file of config `kind` states: { lists, numbers, settings, rulesOff, strictness, budgets, scope } (each possibly empty). */
export function configRecords(kind, text, file) {
  return { lists: [], numbers: [], settings: [], rulesOff: [], strictness: [], budgets: [], scope: [], ...EXTRACT[kind](text, file) };
}

/** `item` as a path core: no quotes, no leading dot-slash, globstar or slash, no trailing slash or star segment, so a folder spelled three ways is one entry. */
export function coreOf(item) {
  let text = String(item).trim();
  if (text.startsWith('"') || text.startsWith("'")) text = text.slice(1);
  if (text.endsWith('"') || text.endsWith("'")) text = text.slice(0, -1);
  for (const lead of ['!', './']) if (text.startsWith(lead)) text = text.slice(lead.length);
  while (text.startsWith('**/')) text = text.slice(3);
  if (text.startsWith('/')) text = text.slice(1);
  for (const tail of ['/**', '/*', '/']) {
    while (text.endsWith(tail)) text = text.slice(0, -tail.length);
  }
  return text;
}

/** Whether the item was spelled as a path at any depth (`**` first), which a rooted allowance does not cover. */
export const isAnyDepth = (item) => String(item).trim().replace(/^["'!]+/, '').startsWith('**/');
