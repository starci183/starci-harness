// project-ext.mts - a project's extension folder (PROJECT-LINT-3, R381): `ext/` at the app root, the one place a project adds its own laws to the
// harness's gates. One subfolder per tool, and one manifest that declares everything the folder holds:
//   ext/manifest.json   { schema: 'starci/project-ext@1', api: <the extension API it targets>, rules?: [<rule>, ...], checks?: [<check>, ...],
//                         packages?: {<folder>: <slots>} }
//   ext/hfs/            machine rules of the hfs family: an ES module whose default export is `(context) => findings`
//   ext/lint/           ESLint rules the canon factories (eslint-canon-be, eslint-canon-fe, the packages config) load: a module whose default
//                       export is an ESLint rule (`{ meta, create }`)
//   ext/checks/         project checks (R402): a `.mjs` program the `checks` step of `starci app check` runs from the app root; exit 0 is green
// Every rule carries an id (`APP-SHAPE-1`), a finding code (`APP_SHAPE_INCOMPLETE`), a severity (error or warning), its doc (a file below ext/ or
// an https link), `appliesTo` (app-relative globs: the paths it judges; a rule reaches a package by naming its paths) and exactly one engine:
//   hfs    '<file>'                                  a file of ext/hfs/; `starci app check` runs it over the tracked files `appliesTo` matches
//   lint   { tool: 'eslint', file: '<file>' }        a file of ext/lint/; loaded for the files `appliesTo` matches in the config that owns them
// Every check is { id, run, why }: a kebab-case id, `run` a file `ext/checks/<name>.mjs`, and what it guards (cache/project-checks.mts runs it).
// An extension only adds: a rule or manifest with any other key (an `off`, `overrides` or `disable`), a code the harness already reports, an id or a
// code declared twice, a declared file that is not there and a manifest of another API version refuse the whole extension (HFS_EXT_INVALID,
// HFS_EXT_API_MISMATCH), which then lends nothing while the check is red. Findings go through the same policy as the harness's own: an hfs rule and
// a project check are hfs findings (blocking on every branch), a lint rule a lint finding (report under a branch profile, held by the ratchet).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { braceVariants, globExpression } from './glob.mjs';

/** The folder of a project's extension, at the app root. */
export const PROJECT_EXT_DIR = 'ext';
/** The manifest that declares every rule and check of the extension. */
export const PROJECT_EXT_MANIFEST = `${PROJECT_EXT_DIR}/manifest.json`;
export const PROJECT_EXT_SCHEMA = 'starci/project-ext@1';
/**
 * The extension API this runtime serves: the shape of the manifest, of a rule's context and findings, and of a project check's declaration. A breaking change
 * raises it, and a manifest that targets another number is refused until the project's ext/ is updated (HFS_EXT_API_MISMATCH).
 */
export const PROJECT_EXT_API = 1;
/** The tool subfolders of ext/, by engine. */
export const PROJECT_EXT_FOLDERS = Object.freeze({ hfs: 'hfs', lint: 'lint', check: 'checks' } as const);
export const PROJECT_EXT_INVALID = 'HFS_EXT_INVALID';
export const PROJECT_EXT_API_MISMATCH = 'HFS_EXT_API_MISMATCH';
/** The scopes a canon config loads lint rules for: the two side folders and the root packages. */
export const EXT_SCOPES = Object.freeze(['be', 'fe', 'packages'] as const);
export type ExtScope = (typeof EXT_SCOPES)[number];
export type ExtSeverity = 'error' | 'warning';

/** One finding an hfs rule returns: the app-relative file it judges and why; line and column when it knows them. */
export interface ExtFinding { path: string; message: string; line?: number; column?: number }
/** What an hfs rule reads (API 1): the API number, the app root, the tracked app-relative files its `appliesTo` matches and their text (null for a file it cannot read). */
export interface ExtContext { api: number; repoRoot: string; files: readonly string[]; read(file: string): string | null }
// reason: an ESLint rule module of an extension is the project's own object; the canon factories hand it to ESLint as it is
type EslintRuleModule = { create: (...args: never[]) => unknown; meta?: unknown };
/** One validated rule of an extension. */
export interface ExtRule {
  readonly id: string;
  readonly code: string;
  readonly severity: ExtSeverity;
  readonly doc: string;
  readonly appliesTo: readonly string[];
  readonly hfs?: (context: ExtContext) => readonly ExtFinding[];
  readonly lint?: { readonly name: string; readonly rule: EslintRuleModule };
}
/** One project check the manifest declares: its id, the file of ext/checks/ it runs and what it guards. */
export interface ExtCheck { readonly id: string; readonly run: string; readonly why: string }
/** A project's extension: every sound rule, the declared project checks, the package declarations as written, and each problem. An extension with any problem lends no rule. */
export interface ProjectExt { present: boolean; rules: ExtRule[]; checks: ExtCheck[]; packages: Record<string, unknown>; problems: { code: string; message: string }[] }

const MANIFEST_KEYS = new Set(['schema', 'api', 'rules', 'checks', 'packages']);
const RULE_KEYS = new Set(['id', 'code', 'severity', 'doc', 'appliesTo', 'hfs', 'lint']);
/** A project check's id (kebab-case) and its file: a `.mjs` file of ext/checks/ (R402). */
const CHECK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CHECK_RUN = /^ext\/checks\/[a-z0-9][a-z0-9._-]*\.mjs$/u;
const ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u;
const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u;
const MODULE_FILE = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*\.(?:mjs|js)$/u;
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const firstLine = (error: unknown): string => String((error as Error | undefined)?.message ?? error).split('\n')[0] as string;

const FAILURE_CODES = new URL('../../modules/kernel/failure-codes.yaml', import.meta.url);
let harnessCodes: ReadonlySet<string> | null = null;
/** Every code the harness reports (the top-level keys of its failure-code catalog), the codes an extension may not take. */
export function reservedCodes(): ReadonlySet<string> {
  if (harnessCodes === null) {
    let catalog = '';
    try { catalog = fs.readFileSync(FAILURE_CODES, 'utf8'); } catch { /* not shipped beside this copy */ }
    harnessCodes = new Set([...catalog.matchAll(/^([A-Z][A-Z0-9_]+):\s*$/gmu)].map((match) => match[1] as string));
  }
  return harnessCodes;
}

/** What the report says about a finding of an extension rule, in the shape of a failure-code catalog entry. */
export interface ExtWhy { title: string; title_vi: string; meaning_vi: string; nextStep_vi: string }
const declaredWhy = new Map<string, ExtWhy>();
/**
 * The catalog entry of a code a loaded extension declares: the rule's id and its doc, since the harness's failure-code catalog holds only the
 * harness's own codes (an extension never takes one of them). Undefined for a code no loaded extension declares.
 */
export const extensionWhy = (code: string): ExtWhy | undefined => declaredWhy.get(code);

/** The app root above `start` (a side folder or the root itself): the nearest folder whose hfs.json declares kind app; null when there is none. */
export function appRootOf(start: string): string | null {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    try {
      const declared = JSON.parse(fs.readFileSync(path.join(dir, 'hfs.json'), 'utf8')) as { kind?: unknown };
      if (declared.kind === 'app') return dir;
    } catch { /* no declaration here: one folder up */ }
    if (path.dirname(dir) === dir) return null;
  }
}

/** The project name hfs.json declares, for a message that names the project. */
function projectName(appRoot: string): string {
  try {
    const declared = JSON.parse(fs.readFileSync(path.join(appRoot, 'hfs.json'), 'utf8')) as { project?: unknown };
    return typeof declared.project === 'string' && declared.project !== '' ? declared.project : path.basename(appRoot);
  } catch { return path.basename(appRoot); }
}

/** True when the app at `appRoot` has an ext/ folder (with or without its manifest). */
export const hasProjectExt = (appRoot: string): boolean => { try { return fs.statSync(path.join(appRoot, PROJECT_EXT_DIR)).isDirectory(); } catch { return false; } };

/**
 * The app-relative files of ext/lint/ that the manifest's rules declare, read from the manifest's text alone (no module is loaded): the lint rules
 * the canon factories load, which are therefore the project's law and no local rule (R16). An absent or unreadable manifest declares none.
 */
export function declaredLintFiles(appRoot: string): Set<string> {
  const declared = new Set<string>();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, PROJECT_EXT_MANIFEST), 'utf8')) as { rules?: unknown };
    for (const rule of Array.isArray(manifest.rules) ? manifest.rules : []) {
      const file = plain(rule) && plain(rule['lint']) ? rule['lint']['file'] : undefined;
      if (typeof file === 'string' && MODULE_FILE.test(file)) declared.add(`${PROJECT_EXT_DIR}/${PROJECT_EXT_FOLDERS.lint}/${file}`);
    }
  } catch { /* no manifest, or one R381 refuses: nothing is declared */ }
  return declared;
}

/** The problem of one `appliesTo` glob, or null: an app-relative glob that starts at a named top-level folder or file, so a rule's reach is declared. */
function globProblem(glob: unknown): string | null {
  if (typeof glob !== 'string' || glob.trim() === '') return 'is not a glob';
  if (glob.includes('\\') || glob.startsWith('/') || glob.startsWith('./') || glob.split('/').includes('..')) return `${glob} is not an app-relative path glob`;
  if (!/^[A-Za-z0-9._-]+(?:\/|$)/u.test(glob)) return `${glob} must start at a named folder or file of the app root (packages/<name>/src/**, be/src/**), never at a wildcard`;
  return null;
}

/** The matcher of a rule's `appliesTo` over app-relative paths. */
export function appliesToMatcher(globs: readonly string[]): (file: string) => boolean {
  const expressions = globs.flatMap((glob) => braceVariants(glob)).map((glob) => globExpression(glob));
  return (file) => expressions.some((expression) => expression.test(file));
}

/** The default export of a module of the extension, loaded through the app's own module system (synchronously: a rule module has no top-level await). */
function loadDefault(appRoot: string, file: string): unknown {
  const loaded = createRequire(path.join(appRoot, 'package.json'))(path.join(appRoot, file)) as { default?: unknown };
  return loaded.default ?? loaded;
}

/** The problems of one rule entry, or the rule when it is sound. */
function judgeRule(appRoot: string, entry: unknown, at: number): { rule?: ExtRule; problems: string[] } {
  const where = `rule ${String(at)}`;
  if (!plain(entry)) return { problems: [`${where} is not an object`] };
  const problems: string[] = [];
  const extra = Object.keys(entry).filter((key) => !RULE_KEYS.has(key));
  if (extra.length > 0) problems.push(`${where} has ${extra.join(', ')}: an extension only adds rules, it never turns one off, overrides or lowers it (keys ${[...RULE_KEYS].join(', ')})`);
  const id = text(entry['id']), code = text(entry['code']), doc = text(entry['doc']);
  const label = id ?? where;
  if (id === null || !ID.test(id)) problems.push(`${where}: id must be an upper-case law id such as APP-SHAPE-1`);
  if (code === null || !CODE.test(code)) problems.push(`${label}: code must be an upper-case finding code such as APP_SHAPE_INCOMPLETE`);
  const severity = entry['severity'];
  if (severity !== 'error' && severity !== 'warning') problems.push(`${label}: severity must be error or warning`);
  const extRoot = path.join(appRoot, PROJECT_EXT_DIR);
  const inExt = (file: string): boolean => { const resolved = path.resolve(appRoot, file); return resolved.startsWith(`${extRoot}${path.sep}`) && fs.existsSync(resolved); };
  if (doc === null || !(/^https:\/\/\S+$/u.test(doc) || inExt(doc))) problems.push(`${label}: doc must be a file below ${PROJECT_EXT_DIR}/ (an app-relative path) or an https link (${doc ?? 'none'})`);
  const globs = Array.isArray(entry['appliesTo']) ? (entry['appliesTo'] as unknown[]) : [];
  if (globs.length === 0) problems.push(`${label}: appliesTo must list the app-relative globs the rule judges`);
  for (const glob of globs) { const bad = globProblem(glob); if (bad !== null) problems.push(`${label}: appliesTo ${bad}`); }
  const engines = (['hfs', 'lint'] as const).filter((key) => entry[key] !== undefined);
  if (engines.length !== 1) problems.push(`${label}: a rule has exactly one engine: hfs (a machine rule of ${PROJECT_EXT_DIR}/${PROJECT_EXT_FOLDERS.hfs}/) or lint (a rule of ${PROJECT_EXT_DIR}/${PROJECT_EXT_FOLDERS.lint}/); a program that checks the app is a check of the manifest's checks list`);
  const moduleOf = (folder: string, file: unknown, what: string): unknown => {
    if (typeof file !== 'string' || !MODULE_FILE.test(file)) { problems.push(`${label}: ${what} must name a .mjs or .js file of ${PROJECT_EXT_DIR}/${folder}/ in kebab-case (${String(file)})`); return undefined; }
    const relative = `${PROJECT_EXT_DIR}/${folder}/${file}`;
    if (!fs.existsSync(path.join(appRoot, relative))) { problems.push(`${label}: ${relative} is declared and is not there`); return undefined; }
    try { return loadDefault(appRoot, relative); } catch (error) { problems.push(`${label}: ${relative} cannot be loaded (${firstLine(error)})`); return undefined; }
  };
  let hfs: ExtRule['hfs'], lint: ExtRule['lint'];
  if (entry['hfs'] !== undefined) {
    const loaded = moduleOf(PROJECT_EXT_FOLDERS.hfs, entry['hfs'], 'hfs');
    if (typeof loaded === 'function') hfs = loaded as NonNullable<ExtRule['hfs']>;
    else if (loaded !== undefined) problems.push(`${label}: ${PROJECT_EXT_DIR}/${PROJECT_EXT_FOLDERS.hfs}/${String(entry['hfs'])} must export by default a function (context) => findings`);
  }
  if (entry['lint'] !== undefined) {
    const declared = entry['lint'];
    const unknown = plain(declared) ? Object.keys(declared).filter((key) => key !== 'tool' && key !== 'file') : [];
    if (!plain(declared) || unknown.length > 0) problems.push(`${label}: lint is { tool, file }`);
    else if (declared['tool'] !== 'eslint') problems.push(`${label}: lint.tool must be eslint, the one lint tool extension API ${String(PROJECT_EXT_API)} loads (${String(declared['tool'])})`);
    else {
      const loaded = moduleOf(PROJECT_EXT_FOLDERS.lint, declared['file'], 'lint.file');
      if (plain(loaded) && typeof loaded['create'] === 'function') lint = { name: String(declared['file']).replace(/\.(?:mjs|js)$/u, '').replace(/\//gu, '-'), rule: loaded as unknown as EslintRuleModule };
      else if (loaded !== undefined) problems.push(`${label}: ${PROJECT_EXT_DIR}/${PROJECT_EXT_FOLDERS.lint}/${String(declared['file'])} must export by default an ESLint rule with create()`);
    }
  }
  if (problems.length > 0) return { problems };
  return { rule: { id: id as string, code: code as string, severity: severity as ExtSeverity, doc: doc as string, appliesTo: globs as string[], ...(hfs === undefined ? {} : { hfs }), ...(lint === undefined ? {} : { lint }) }, problems: [] };
}

/** The problems of the manifest's `checks` list, and the checks when it is sound: each { id, run, why }, ids and files unique, every file there. */
function judgeChecks(appRoot: string, declared: unknown): { checks: ExtCheck[]; problems: string[] } {
  if (declared === undefined) return { checks: [], problems: [] };
  const shape = 'checks is a list of { id, run, why }: a unique kebab-case id, run a unique ext/checks/<name>.mjs file and what the check guards, nothing else';
  if (!Array.isArray(declared) || declared.length === 0) return { checks: [], problems: [shape] };
  const problems: string[] = [];
  const checks: ExtCheck[] = [];
  for (const [at, entry] of declared.entries()) {
    if (!plain(entry) || Object.keys(entry).some((key) => !['id', 'run', 'why'].includes(key)) || typeof entry['id'] !== 'string' || !CHECK_ID.test(entry['id']) || typeof entry['run'] !== 'string' || !CHECK_RUN.test(entry['run']) || text(entry['why']) === null) { problems.push(`check ${String(at)}: ${shape}`); continue; }
    if (checks.some((other) => other.id === entry['id'])) problems.push(`check ${entry['id']}: the id is declared twice`);
    if (checks.some((other) => other.run === entry['run'])) problems.push(`check ${entry['id']}: ${entry['run']} is the file of another check too`);
    if (!fs.existsSync(path.join(appRoot, entry['run']))) problems.push(`check ${entry['id']}: ${entry['run']} is declared and is not there`);
    checks.push({ id: entry['id'], run: entry['run'], why: text(entry['why']) as string });
  }
  return problems.length > 0 ? { checks: [], problems } : { checks, problems };
}

/** Every file of ext/<folder>/ as a path relative to that folder (forward slashes), none when the folder is absent. */
function filesBelow(root: string, folder = ''): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(path.join(root, folder), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => (entry.isDirectory() ? filesBelow(root, `${folder}${entry.name}/`) : [`${folder}${entry.name}`]));
}

/**
 * The extension of the app at `appRoot`, read and judged. `reserved` holds the codes the harness reports: an extension never reuses one. An app
 * without an ext/ folder has no extension (`present` false) and no problem.
 */
export function loadProjectExt(appRoot: string, reserved: ReadonlySet<string> = reservedCodes()): ProjectExt {
  const result: ProjectExt = { present: hasProjectExt(appRoot), rules: [], checks: [], packages: {}, problems: [] };
  if (!result.present) return result;
  const fail = (message: string, code = PROJECT_EXT_INVALID): ProjectExt => { result.problems.push({ code, message }); return result; };
  let manifest: unknown;
  try { manifest = JSON.parse(fs.readFileSync(path.join(appRoot, PROJECT_EXT_MANIFEST), 'utf8')); } catch (error) { return fail(`cannot be read as JSON (${firstLine(error)}); a ${PROJECT_EXT_DIR}/ folder declares what it holds in its manifest`); }
  if (!plain(manifest) || manifest['schema'] !== PROJECT_EXT_SCHEMA) return fail(`is not a ${PROJECT_EXT_SCHEMA} manifest`);
  const api = manifest['api'];
  if (typeof api !== 'number' || !Number.isInteger(api) || api < 1) return fail('api must be the extension API version the folder targets, a whole number');
  if (api !== PROJECT_EXT_API) {
    const fix = api < PROJECT_EXT_API ? `update the project's ${PROJECT_EXT_DIR}/ to API ${String(PROJECT_EXT_API)} (the @starci/hfs README "Extension API" lists what changed)` : 'install the @starci/hfs that serves it';
    return fail(`project ${projectName(appRoot)} targets extension API ${String(api)} and this @starci/hfs serves API ${String(PROJECT_EXT_API)}: ${fix}; until then none of its rules runs`, PROJECT_EXT_API_MISMATCH);
  }
  const extra = Object.keys(manifest).filter((key) => !MANIFEST_KEYS.has(key));
  if (extra.length > 0) return fail(`has ${extra.join(', ')}: an extension holds only ${[...MANIFEST_KEYS].join(', ')}; it adds rules and never changes one of the harness`);
  const entries = Array.isArray(manifest['rules']) ? manifest['rules'] : [];
  if (manifest['rules'] !== undefined && !Array.isArray(manifest['rules'])) return fail('rules is a list');
  if (manifest['packages'] !== undefined && !plain(manifest['packages'])) return fail('packages maps a root package folder (packages/<name>) to its slots');
  if (entries.length === 0 && manifest['checks'] === undefined && manifest['packages'] === undefined) return fail('declares no rule, no check and no package');
  const judged = entries.map((entry, at) => judgeRule(appRoot, entry, at));
  const judgedChecks = judgeChecks(appRoot, manifest['checks']);
  const problems = [...judged.flatMap((one) => one.problems), ...judgedChecks.problems];
  const sound = judged.flatMap((one) => (one.rule === undefined ? [] : [one.rule]));
  for (const [at, rule] of sound.entries()) {
    if (sound.findIndex((other) => other.id === rule.id) < at) problems.push(`${rule.id}: the id is declared twice`);
    if (sound.findIndex((other) => other.code === rule.code) < at) problems.push(`${rule.id}: ${rule.code} is the code of another rule too`);
    if (reserved.has(rule.code)) problems.push(`${rule.id}: ${rule.code} is a code the harness reports; an extension adds its own codes and never stands in for a harness rule`);
  }
  // Every module of a tool folder is declared: a rule file nothing names would look like a law and judge nothing.
  for (const engine of ['hfs', 'lint'] as const) {
    const folder = PROJECT_EXT_FOLDERS[engine];
    const named = new Set(entries.flatMap((entry) => { const value = plain(entry) ? (engine === 'hfs' ? entry['hfs'] : plain(entry['lint']) ? entry['lint']['file'] : undefined) : undefined; return typeof value === 'string' ? [value] : []; }));
    for (const file of filesBelow(path.join(appRoot, PROJECT_EXT_DIR, folder))) if (MODULE_FILE.test(file) && !named.has(file)) problems.push(`${PROJECT_EXT_DIR}/${folder}/${file} is declared by no rule of the manifest`);
  }
  if (problems.length > 0) { for (const message of problems) fail(message); return result; }
  result.rules = sound;
  for (const rule of sound) declaredWhy.set(rule.code, {
    title: `${rule.id}: a law of this project's extension (${PROJECT_EXT_MANIFEST})`,
    title_vi: `${rule.id}: luật riêng của dự án (${PROJECT_EXT_MANIFEST})`,
    meaning_vi: `Dự án khai luật ${rule.id} trong ${PROJECT_EXT_MANIFEST} cho các đường dẫn ${rule.appliesTo.join(', ')}; harness chỉ chạy luật này, nội dung của nó là của dự án.`,
    nextStep_vi: `Đọc tài liệu của luật (${rule.doc}), sửa chỗ vi phạm rồi chạy lại starci app check.`,
  });
  result.checks = judgedChecks.checks;
  result.packages = plain(manifest['packages']) ? manifest['packages'] : {};
  return result;
}

/** The package declarations of the app's manifest (`packages`), by app-relative folder; empty when the app has no sound extension. */
export function declaredExtPackages(appRoot: string): Record<string, unknown> {
  return loadProjectExt(appRoot).packages;
}

const PLUGIN = 'project-ext';
/** One plugin object per rule set, so two blocks of one config hand ESLint the same plugin. */
const plugins = new Map<string, { rules: Record<string, EslintRuleModule> }>();
const pluginOf = (appRoot: string, rules: readonly ExtRule[]): { rules: Record<string, EslintRuleModule> } => {
  const key = `${appRoot}|${rules.map((rule) => rule.id).join(',')}`;
  let made = plugins.get(key);
  if (made === undefined) { made = { rules: Object.fromEntries(rules.map((rule) => [rule.lint?.name as string, rule.lint?.rule as EslintRuleModule])) }; plugins.set(key, made); }
  return made;
};

/**
 * The flat-config blocks that load the lint rules of the app's extension in the config at `start` (the folder of the eslint.config.mjs), for a canon
 * factory: one block per rule, over the files its `appliesTo` names inside that config's scope (a side's own folder, or `packages/` for the root
 * packages config), each rule at its severity under the plugin `project-ext`. Throws when the extension is refused: a lint run never guesses
 * which of a project's laws hold.
 */
export function extEslintConfigs(start: string, scope: ExtScope): { files: string[]; plugins: Record<string, { rules: Record<string, EslintRuleModule> }>; rules: Record<string, 'error' | 'warn'> }[] {
  const appRoot = appRootOf(start);
  if (appRoot === null || !hasProjectExt(appRoot)) return [];
  const ext = loadProjectExt(appRoot);
  if (ext.problems.length > 0) throw new Error(`${ext.problems[0]?.code ?? PROJECT_EXT_INVALID}: ${PROJECT_EXT_MANIFEST} ${ext.problems.map((problem) => problem.message).join('; ')} (PROJECT-LINT-3)`);
  const base = path.relative(appRoot, path.resolve(start)).split(path.sep).join('/');
  const prefix = scope === 'packages' ? 'packages/' : `${base === '' ? scope : base}/`;
  const strip = scope === 'packages' ? base === '' ? '' : `${base}/` : prefix;
  const lintRules = ext.rules.filter((rule) => rule.lint !== undefined);
  const plugin = pluginOf(appRoot, lintRules);
  return lintRules.flatMap((rule) => {
    const files = rule.appliesTo.filter((glob) => glob.startsWith(prefix)).map((glob) => glob.slice(strip.length));
    return files.length === 0 ? [] : [{ files, plugins: { [PLUGIN]: plugin }, rules: { [`${PLUGIN}/${rule.lint?.name as string}`]: rule.severity === 'error' ? 'error' as const : 'warn' as const } }];
  });
}

/** One finding of the extension, as the app check reports it. `always` marks one that no path scope filters out (a refused extension). */
export interface ExtCheckFinding { code: string; level: ExtSeverity; path: string; message: string; line?: number; column?: number; always?: boolean }
/**
 * The findings of the app's extension over `files` (the tracked app-relative files): one HFS_EXT_INVALID or HFS_EXT_API_MISMATCH per problem of a
 * refused extension; else the findings of every hfs rule over the files its `appliesTo` matches. The project checks run as their own step
 * (cache/project-checks.mts).
 */
export function projectExtFindings({ repoRoot, files, reserved, read }: { repoRoot: string; files: readonly string[]; reserved: ReadonlySet<string>; read: (file: string) => string | null }): ExtCheckFinding[] {
  const ext = loadProjectExt(repoRoot, reserved);
  const invalid = (message: string, code = PROJECT_EXT_INVALID): ExtCheckFinding => ({ code, level: 'error', path: PROJECT_EXT_MANIFEST, message: `${PROJECT_EXT_MANIFEST} ${message} (R381, PROJECT-LINT-3)`, always: true });
  if (ext.problems.length > 0) return ext.problems.map((problem) => invalid(problem.message, problem.code));
  const out: ExtCheckFinding[] = [];
  for (const rule of ext.rules) {
    const applies = appliesToMatcher(rule.appliesTo);
    const reached = files.filter((file) => applies(file));
    if (rule.hfs !== undefined) {
      const context: ExtContext = Object.freeze({ api: PROJECT_EXT_API, repoRoot, files: Object.freeze([...reached]), read });
      let found: readonly ExtFinding[];
      try { found = rule.hfs(context); } catch (error) { out.push(invalid(`${rule.id} threw (${firstLine(error)}); a rule that cannot judge is no rule`)); continue; }
      for (const finding of Array.isArray(found) ? found : []) {
        if (!plain(finding) || text(finding.path) === null || text(finding.message) === null) { out.push(invalid(`${rule.id} returned a finding without a path and a message`)); continue; }
        out.push({ code: rule.code, level: rule.severity, path: String(finding.path), message: `${String(finding.message)} (${rule.id}, ${rule.doc})`, ...(typeof finding.line === 'number' ? { line: finding.line } : {}), ...(typeof finding.column === 'number' ? { column: finding.column } : {}) });
      }
    }
  }
  return out;
}
