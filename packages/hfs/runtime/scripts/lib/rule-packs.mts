// rule-packs.mjs - an app's rule packs (PROJECT-LINT-3): the packages hfs.json `rulePacks` names, each adding the app's own laws to the harness's
// gates without a local rule in a tool config. A pack is an installed package that exports `./rule-pack`, an ES module whose default export is
//   { schema: 'starci/rule-pack@1', name: '<the package name>', rules: [<rule>, ...] }
// and every rule carries an id (`NIVO-BLOCK-1`), a finding code (`NIVO_BLOCK_INCOMPLETE`), a severity (error or warning), the spec that proves it
// (a file of the package) and its doc (a file of the package or an https link), plus exactly one engine:
//   check   a machine rule `(context) => findings` of the hfs family: `starci app check` runs it over the tracked files (context.files, context.read)
//   eslint  { name, rule, sides } an ESLint rule the canon factories (eslint-canon-be, eslint-canon-fe, the packages config) load for the sides it names
// A pack only adds: a rule with any other key (an `off`, `overrides` or `disable`), a code the harness already reports, or an id or code another
// pack uses is refused (HFS_RULE_PACK_INVALID, R381) and the pack lends nothing. Pack findings go through the same policy as the harness's own:
// a check rule is an hfs finding (blocking on every branch), an eslint rule a lint finding (report under a branch profile, held by the ratchet).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const RULE_PACK_SCHEMA = 'starci/rule-pack@1';
/** The subpath a pack exports its manifest at. */
export const RULE_PACK_ENTRY = 'rule-pack';
/** The sides an eslint pack rule may name: the two side folders and the root packages. */
export const PACK_SIDES = Object.freeze(['be', 'fe', 'packages'] as const);
export type PackSide = (typeof PACK_SIDES)[number];
export type PackSeverity = 'error' | 'warning';

/** One finding a check rule returns: the app-relative file it judges and why; line and column when it knows them. */
export interface PackFinding { path: string; message: string; line?: number; column?: number }
/** What a check rule reads: the app root, the tracked app-relative files and their text (null for a file it cannot read). */
export interface PackContext { repoRoot: string; files: readonly string[]; read(file: string): string | null }
// reason: an ESLint rule module of a pack is the pack's own object; the canon factories hand it to ESLint as it is
type EslintRuleModule = { create: (...args: never[]) => unknown; meta?: unknown };
/** One validated rule of a pack. */
export interface PackRule {
  readonly pack: string;
  readonly id: string;
  readonly code: string;
  readonly severity: PackSeverity;
  readonly spec: string;
  readonly doc: string;
  readonly check?: (context: PackContext) => readonly PackFinding[];
  readonly eslint?: { readonly name: string; readonly rule: EslintRuleModule; readonly sides: readonly PackSide[] };
}
/** The packs of an app: every sound rule, and each problem (the pack named, why). A pack with any problem lends no rule. */
export interface RulePacks { rules: PackRule[]; problems: { pack: string; message: string }[] }

const RULE_KEYS = new Set(['id', 'code', 'severity', 'spec', 'doc', 'check', 'eslint']);
const ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u;
const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u;
const ESLINT_NAME = /^[a-z][a-z0-9-]*$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const FAILURE_CODES = new URL('../../modules/kernel/failure-codes.yaml', import.meta.url);
let harnessCodes: ReadonlySet<string> | null = null;
/**
 * Every code the harness reports (the top-level keys of its failure-code catalog), the codes a pack may not take; empty where the catalog is not
 * shipped (a canon package's runtime copy), where the app check refuses such a pack instead.
 */
export function reservedCodes(): ReadonlySet<string> {
  if (harnessCodes === null) {
    let catalog = '';
    try { catalog = fs.readFileSync(FAILURE_CODES, 'utf8'); } catch { /* not shipped beside this copy */ }
    harnessCodes = new Set([...catalog.matchAll(/^([A-Z][A-Z0-9_]+):\s*$/gmu)].map((match) => match[1] as string));
  }
  return harnessCodes;
}

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

/** The pack names hfs.json `rulePacks` declares (its shape is judged by the declaration check). */
export function declaredRulePacks(appRoot: string): string[] {
  try {
    const declared = JSON.parse(fs.readFileSync(path.join(appRoot, 'hfs.json'), 'utf8')) as { rulePacks?: unknown };
    return Array.isArray(declared.rulePacks) ? declared.rulePacks.filter((name): name is string => typeof name === 'string') : [];
  } catch { return []; }
}

/** The problems of one rule entry of pack `pack` (whose folder is `root`), or the rule when it is sound. */
function judgeRule(pack: string, root: string, entry: unknown, at: number): { rule?: PackRule; problems: string[] } {
  const where = `rule ${String(at)}`;
  if (!plain(entry)) return { problems: [`${where} is not an object`] };
  const problems: string[] = [];
  const extra = Object.keys(entry).filter((key) => !RULE_KEYS.has(key));
  if (extra.length > 0) problems.push(`${where} has ${extra.join(', ')}: a pack only adds rules, it never turns one off, overrides or lowers it (keys ${[...RULE_KEYS].join(', ')})`);
  const id = text(entry['id']), code = text(entry['code']), spec = text(entry['spec']), doc = text(entry['doc']);
  const label = id ?? where;
  if (id === null || !ID.test(id)) problems.push(`${where}: id must be an upper-case law id such as NIVO-BLOCK-1`);
  if (code === null || !CODE.test(code)) problems.push(`${label}: code must be an upper-case finding code such as NIVO_BLOCK_INCOMPLETE`);
  const severity = entry['severity'];
  if (severity !== 'error' && severity !== 'warning') problems.push(`${label}: severity must be error or warning`);
  const inPack = (file: string): boolean => { const resolved = path.resolve(root, file); return resolved.startsWith(`${path.resolve(root)}${path.sep}`) && fs.existsSync(resolved); };
  if (spec === null || !inPack(spec)) problems.push(`${label}: spec must name the file of the package that proves the rule (${spec ?? 'none'} is not there)`);
  if (doc === null || !(/^https:\/\/\S+$/u.test(doc) || inPack(doc))) problems.push(`${label}: doc must be a file of the package or an https link (${doc ?? 'none'})`);
  const check = entry['check'];
  const eslint = entry['eslint'];
  if ((check === undefined) === (eslint === undefined)) problems.push(`${label}: a rule has exactly one engine, check (a machine rule of the app check) or eslint (a rule the canon factories load)`);
  if (check !== undefined && typeof check !== 'function') problems.push(`${label}: check must be a function (context) => findings`);
  let lint: NonNullable<PackRule['eslint']> | undefined;
  if (eslint !== undefined) {
    const name = plain(eslint) ? text(eslint['name']) : null;
    const rule = plain(eslint) ? eslint['rule'] : undefined;
    const sides = plain(eslint) && Array.isArray(eslint['sides']) ? (eslint['sides'] as unknown[]) : [];
    if (name === null || !ESLINT_NAME.test(name)) problems.push(`${label}: eslint.name must be a kebab-case rule name`);
    if (!plain(rule) || typeof rule['create'] !== 'function') problems.push(`${label}: eslint.rule must be an ESLint rule module with create()`);
    if (sides.length === 0 || sides.some((side) => !(PACK_SIDES as readonly unknown[]).includes(side))) problems.push(`${label}: eslint.sides must name some of ${PACK_SIDES.join(', ')}`);
    if (name !== null && plain(rule)) lint = { name, rule: rule as unknown as EslintRuleModule, sides: sides as PackSide[] };
  }
  if (problems.length > 0) return { problems };
  return { rule: { pack, id: id as string, code: code as string, severity: severity as PackSeverity, spec: spec as string, doc: doc as string, ...(typeof check === 'function' ? { check: check as NonNullable<PackRule['check']> } : {}), ...(lint === undefined ? {} : { eslint: lint }) }, problems: [] };
}

/**
 * The rule packs of the app at `appRoot`, loaded through the app's own install (a pack is an ES module required synchronously, so a pack has no
 * top-level await) and judged. `reserved` holds the codes the harness reports: a pack never reuses one.
 */
export function loadRulePacks(appRoot: string, reserved: ReadonlySet<string> = reservedCodes()): RulePacks {
  const result: RulePacks = { rules: [], problems: [] };
  const names = declaredRulePacks(appRoot);
  const ids = new Map<string, string>(), codes = new Map<string, string>();
  const requireHere = createRequire(path.join(appRoot, 'package.json'));
  for (const name of names) {
    const fail = (message: string): void => { result.problems.push({ pack: name, message }); };
    if (!PACKAGE_NAME.test(name)) { fail('is not a package name'); continue; }
    let manifest: unknown, root: string;
    try {
      root = path.dirname(requireHere.resolve(`${name}/package.json`));
      const loaded = requireHere(`${name}/${RULE_PACK_ENTRY}`) as { default?: unknown };
      manifest = loaded.default ?? loaded;
    } catch (error) { fail(`cannot be loaded from the app's install (${name}/${RULE_PACK_ENTRY}): ${String((error as Error | undefined)?.message ?? error).split('\n')[0]}`); continue; }
    if (!plain(manifest) || manifest['schema'] !== RULE_PACK_SCHEMA) { fail(`its ${RULE_PACK_ENTRY} export is not a ${RULE_PACK_SCHEMA} manifest`); continue; }
    if (manifest['name'] !== name) { fail(`its manifest names ${String(manifest['name'])}, not the package`); continue; }
    const extra = Object.keys(manifest).filter((key) => !['schema', 'name', 'rules'].includes(key));
    if (extra.length > 0) { fail(`its manifest has ${extra.join(', ')}: a pack holds only schema, name and the rules it adds`); continue; }
    const entries = Array.isArray(manifest['rules']) ? manifest['rules'] : [];
    if (entries.length === 0) { fail('adds no rule'); continue; }
    const judged = entries.map((entry, at) => judgeRule(name, root, entry, at));
    const problems = judged.flatMap((one) => one.problems);
    const sound = judged.flatMap((one) => (one.rule === undefined ? [] : [one.rule]));
    for (const [at, rule] of sound.entries()) {
      if (sound.findIndex((other) => other.id === rule.id) < at) problems.push(`${rule.id}: the id is also a rule of ${name}`);
      if (sound.findIndex((other) => other.code === rule.code) < at) problems.push(`${rule.id}: ${rule.code} is also a code of ${name}`);
      if (reserved.has(rule.code)) problems.push(`${rule.id}: ${rule.code} is a code the harness reports; a pack adds its own codes and never stands in for a harness rule`);
      const otherId = ids.get(rule.id), otherCode = codes.get(rule.code);
      if (otherId !== undefined) problems.push(`${rule.id}: the id is also a rule of ${otherId}`);
      if (otherCode !== undefined) problems.push(`${rule.id}: ${rule.code} is also a code of ${otherCode}`);
    }
    if (problems.length > 0) { for (const message of problems) fail(message); continue; }
    for (const rule of sound) { ids.set(rule.id, name); codes.set(rule.code, name); result.rules.push(rule); }
  }
  return result;
}

/** One plugin object per pack and rule set, so two blocks of one config that name a pack hand ESLint the same plugin. */
const plugins = new Map<string, { rules: Record<string, EslintRuleModule> }>();
const pluginOf = (pack: string, rules: readonly PackRule[]): { rules: Record<string, EslintRuleModule> } => {
  const key = `${pack}|${rules.map((rule) => rule.id).join(',')}`;
  let made = plugins.get(key);
  if (made === undefined) { made = { rules: Object.fromEntries(rules.map((rule) => [rule.eslint?.name as string, rule.eslint?.rule as EslintRuleModule])) }; plugins.set(key, made); }
  return made;
};

/**
 * The flat-config blocks that load the eslint rules of the app's packs for `side`, for a canon factory: one plugin per pack (named by the package)
 * and each rule at its severity. Throws when a pack is refused: a lint run never guesses which of an app's laws hold.
 */
export function packEslintConfigs(start: string, side: PackSide, files: readonly string[] = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']): { files: string[]; plugins: Record<string, { rules: Record<string, EslintRuleModule> }>; rules: Record<string, 'error' | 'warn'> }[] {
  const appRoot = appRootOf(start);
  if (appRoot === null || declaredRulePacks(appRoot).length === 0) return [];
  const packs = loadRulePacks(appRoot);
  if (packs.problems.length > 0) throw new Error(`HFS_RULE_PACK_INVALID: ${packs.problems.map((problem) => `${problem.pack} ${problem.message}`).join('; ')} (hfs.json rulePacks, PROJECT-LINT-3)`);
  const byPack = new Map<string, PackRule[]>();
  for (const rule of packs.rules) if (rule.eslint?.sides.includes(side)) byPack.set(rule.pack, [...(byPack.get(rule.pack) ?? []), rule]);
  return [...byPack].map(([pack, rules]) => ({
    files: [...files],
    plugins: { [pack]: pluginOf(pack, rules) },
    rules: Object.fromEntries(rules.map((rule) => [`${pack}/${rule.eslint?.name as string}`, rule.severity === 'error' ? 'error' : 'warn'])),
  }));
}

/** The findings of the check rules of the app's packs over `files`, and one HFS_RULE_PACK_INVALID per refused pack or per rule that threw. */
export function rulePackFindings({ repoRoot, files, reserved, read }: { repoRoot: string; files: readonly string[]; reserved: ReadonlySet<string>; read: (file: string) => string | null }): { code: string; level: 'error' | 'warning'; path: string; message: string; line?: number; column?: number }[] {
  const packs = loadRulePacks(repoRoot, reserved);
  const out: ReturnType<typeof rulePackFindings> = packs.problems.map((problem) => ({ code: RULE_PACK_INVALID, level: 'error', path: 'hfs.json', message: `hfs.json rulePacks: ${problem.pack} ${problem.message} (R381, PROJECT-LINT-3)` }));
  const context: PackContext = Object.freeze({ repoRoot, files: Object.freeze([...files]), read });
  for (const rule of packs.rules) {
    if (rule.check === undefined) continue;
    let found: readonly PackFinding[];
    try { found = rule.check(context); } catch (error) {
      out.push({ code: RULE_PACK_INVALID, level: 'error', path: 'hfs.json', message: `hfs.json rulePacks: ${rule.pack} ${rule.id} threw (${String((error as Error | undefined)?.message ?? error).split('\n')[0]}); a rule that cannot judge is no rule (R381)` });
      continue;
    }
    for (const finding of Array.isArray(found) ? found : []) {
      if (!plain(finding) || text(finding.path) === null || text(finding.message) === null) { out.push({ code: RULE_PACK_INVALID, level: 'error', path: 'hfs.json', message: `hfs.json rulePacks: ${rule.pack} ${rule.id} returned a finding without a path and a message (R381)` }); continue; }
      out.push({ code: rule.code, level: rule.severity, path: String(finding.path), message: `${String(finding.message)} (${rule.id}, ${rule.doc})`, ...(typeof finding.line === 'number' ? { line: finding.line } : {}), ...(typeof finding.column === 'number' ? { column: finding.column } : {}) });
    }
  }
  return out;
}

export const RULE_PACK_INVALID = 'HFS_RULE_PACK_INVALID';
