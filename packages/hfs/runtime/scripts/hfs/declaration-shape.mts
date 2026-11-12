// declaration-shape.mts - the dependency-free hfs.json shape validation used by the HFS slot loader. Semantic checks
// against a loaded manifest remain in slots.mts; this module mirrors modules/schemas/hfs-repo.schema.yaml only.
import type { Parsed } from './manifest-shape.mjs';
import { isPlainObject } from '../../engine/plain-object.mjs';
import { APP_KIND, connectionShapeProblems, NAME, PACKAGE_NAME, RUNTIME_KIND, SLOT_ID } from './manifest-shape.mjs';
import { dbFunctionsOk, ddlRenderersOk, sqlPassThroughOk } from './rule-params-shape.mjs';
import { engineOwnedOk } from './engine-owned.mjs';
import { baselineResetOk } from './rules/database-reset.mjs';
import { kindShapeProblems, patternShapeProblems } from './declaration-slots.mjs';
import { byCodeUnit } from '../lib/list.mjs';
import { CONTRACT_KINDS, DEFAULT_CONTRACT } from './contract-kind.mjs';
import { PROJECT_SIDES, isProjectSide } from './project-sides.mjs';

/** Shape problems of the optional hfs.json `db` block of a lite app: the environment variable naming its database, its image, forced RLS and its application role. */
const isStringList = (value: Parsed) => Array.isArray(value) && value.every((entry: Parsed) => typeof entry === 'string' && entry.trim());

/** One db.destructiveRulings entry on a migration's destructive DDL: the exact file, the exact objects, the reason and the date it was accepted. */
const isDestructiveRuling = (ruling: Parsed): boolean => isPlainObject(ruling)
  && typeof ruling.migration === 'string' && /^db\/migrations\/\d{14}_[a-z0-9_-]+\.sql$/.test(ruling.migration)
  && isStringList(ruling.objects) && ruling.objects.length > 0
  && typeof ruling.reason === 'string' && ruling.reason.trim() !== ''
  && typeof ruling.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ruling.date)
  && Object.keys(ruling).every((key) => ['migration', 'objects', 'reason', 'date'].includes(key));

function dbBlockProblems(block: Parsed): string[] {
  if (block === undefined) return [];
  if (!isPlainObject(block)) return ['db must be an object'];
  const bad: string[] = [];
  for (const key of Object.keys(block)) if (!['urlEnv', 'image', 'forceRls', 'forceRlsExemptions', 'appRole', 'scopeSettings', 'scopeColumns', 'scopeRoles', 'baselineReset', 'destructiveRulings'].includes(key)) bad.push(`db has unknown key ${key}`);
  if (block.urlEnv !== undefined && (typeof block.urlEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(block.urlEnv))) bad.push('db.urlEnv must name an UPPER_CASE environment variable');
  if (block.image !== undefined && (typeof block.image !== 'string' || !/@sha256:[0-9a-f]{64}$/.test(block.image))) bad.push('db.image must be a digest-pinned image reference');
  if (block.forceRls !== undefined && !isStringList(block.forceRls)) bad.push('db.forceRls must be a list of strings');
  if (block.appRole !== undefined && (typeof block.appRole !== 'string' || !/^[a-z][a-z0-9_]*$/.test(block.appRole))) bad.push('db.appRole must name a role');
  if (block.scopeSettings !== undefined && !(isStringList(block.scopeSettings) && block.scopeSettings.every((setting: string) => /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/.test(setting) && !setting.startsWith('request.jwt.')))) bad.push('db.scopeSettings must list custom transaction settings the app sets per request, each a dotted lower-case name such as nivo.workspace_id (never request.jwt.*)');
  if (block.scopeColumns !== undefined && !(isStringList(block.scopeColumns) && block.scopeColumns.length > 0 && block.scopeColumns.every((column: string) => /^[a-z_][a-z0-9_]*$/.test(column)))) bad.push('db.scopeColumns must list the owning column names a scope policy compares (default workspace_id)');
  if (block.scopeRoles !== undefined && !(Array.isArray(block.scopeRoles) && block.scopeRoles.length > 0 && block.scopeRoles.every((entry: Parsed) => isPlainObject(entry) && typeof entry.role === 'string' && /^[a-z][a-z0-9_]*$/.test(entry.role) && typeof entry.reason === 'string' && entry.reason.trim() !== '' && Object.keys(entry).every((key) => key === 'role' || key === 'reason')))) bad.push('db.scopeRoles must be a list of { role, reason } naming the NOLOGIN roles whose policies may read a db.scopeSettings setting');
  if (block.scopeSettings !== undefined && !(Array.isArray(block.scopeRoles) && block.scopeRoles.length > 0)) bad.push('db.scopeSettings needs db.scopeRoles: a declared setting counts only in policies of declared scope roles');
  if (block.baselineReset !== undefined && !baselineResetOk(block.baselineReset)) bad.push('db.baselineReset must be { baseline (db/migrations/<ts14>_<name>.sql), ruling (the reset id), date (YYYY-MM-DD), reason } declaring the one baseline that replaces the whole older migration history');
  if (block.forceRlsExemptions !== undefined && !Array.isArray(block.forceRlsExemptions)) bad.push('db.forceRlsExemptions must be a list of { table, reason }');
  if (block.destructiveRulings !== undefined && !(Array.isArray(block.destructiveRulings) && block.destructiveRulings.every(isDestructiveRuling))) bad.push('db.destructiveRulings must be a list of { migration, objects, reason, date } naming one db/migrations file, the objects it destroys, why and the date it was accepted (YYYY-MM-DD)');
  return bad;
}

/** The keys of one app entry: its folder name and kind, and for a client cli the npm package it is published as and the command it installs. */
const APP_KEYS = ['name', 'kind', 'contract', 'package', 'bin'];

function appShapeProblems(apps: Parsed, at: Parsed, side: Parsed, names: Parsed): string[] {
  const bad: string[] = [];
  if (!Array.isArray(apps) || !apps.length) {
    bad.push(`${at}.apps must list every ${side}/apps/<name> with its kind`);
    return bad;
  }
  apps.forEach((app, index) => {
    if (!isPlainObject(app) || !NAME.test(String(app.name)) || !NAME.test(String(app.kind)) || Object.keys(app).some((key: Parsed) => !APP_KEYS.includes(key))) bad.push(`${at}.apps[${index}] must be {name, kind} (an api app of be may add contract; a client cli adds package and bin)`);
    else if (app.contract !== undefined && (side !== 'be' || app.kind !== 'api' || !CONTRACT_KINDS.includes(app.contract))) bad.push(`${at}.apps[${index}].contract is declared by an api app of be only, as ${CONTRACT_KINDS.join(' or ')} (absent: ${DEFAULT_CONTRACT})`);
    else if (app.package !== undefined && !(typeof app.package === 'string' && app.package.length <= 214 && PACKAGE_NAME.test(app.package))) bad.push(`${at}.apps[${index}].package must be an npm package name`);
    else if (app.bin !== undefined && !(typeof app.bin === 'string' && NAME.test(app.bin))) bad.push(`${at}.apps[${index}].bin must be a command name`);
    else if (names.has(app.name)) bad.push(`app ${app.name} is declared twice (${names.get(app.name)} and ${side})`);
    else names.set(app.name, side);
  });
  const kinds = new Set(apps.filter((app: Parsed) => isPlainObject(app) && app.kind === 'api').map((app: Parsed) => app.contract ?? DEFAULT_CONTRACT));
  if (side === 'be' && kinds.size > 1) bad.push(`${at}.apps declare api apps of both contracts (${[...kinds].sort().join(', ')}): the api apps of one back end serve one contract kind, since their features are shared`);
  return bad;
}

function connectionProblems(side: Parsed, value: Parsed): string[] {
  const bad: string[] = [];
  if (side !== 'be') {
    bad.push('connections belong to the be side');
    return bad;
  }
  const list = Array.isArray(value.connections) ? value.connections : null;
  const shape = connectionShapeProblems(list, value.apps);
  if (shape.length) {
    bad.push(...shape);
    return bad;
  }
  if (new Set(list.map((connection: Parsed) => connection.name)).size !== list.length) bad.push('connections names must be unique');
  for (const a of list) for (const b of list) if (a !== b && `${b.envPrefix}_`.startsWith(`${a.envPrefix}_`)) bad.push(`connections ${a.name} and ${b.name} share env keys (${a.envPrefix}_ covers ${b.envPrefix}_)`);
  return bad;
}

/** Whether a declared list is present but not a list of distinct entries that all satisfy `valid`. */
const isBadUniqueList = (list: Parsed, valid: Parsed) => list !== undefined && (!Array.isArray(list) || !list.every((entry: Parsed) => valid(entry)) || new Set(list).size !== list.length);

function validExtraPackage(entry: Parsed) {
  return isPlainObject(entry) && Object.keys(entry).every(key => key === 'name' || key === 'reason')
    && typeof entry.name === 'string' && entry.name.length <= 214 && PACKAGE_NAME.test(entry.name)
    && typeof entry.reason === 'string' && entry.reason.trim().length > 0;
}

function extraPackageProblems(side: Parsed, entries: Parsed): string[] {
  if (entries === undefined) return [];
  if (side !== 'fe') return ['extraPackages belong to the fe side'];
  if (!Array.isArray(entries) || !entries.every(validExtraPackage)) return ['sides.fe.extraPackages must be a list of {name, reason} with a package name and a nonempty reason'];
  return [];
}

function grammarProblems(side: Parsed, grammar: Parsed): string[] {
  if (grammar === undefined) return [];
  if (side !== 'fe') return ['grammar belongs to the fe side'];
  return typeof grammar === 'string' && NAME.test(grammar) ? [] : ['sides.fe.grammar must name a Grammar family'];
}

function declarationSideProblems(side: Parsed, value: Parsed, names: Parsed): string[] {
  const bad: string[] = [];
  const at = `sides.${side}`;
  if (!isPlainObject(value)) return [`${at} must be an object`];
  for (const key of Object.keys(value)) if (!['apps', 'optionalSlots', 'patterns', 'kinds', 'connections', 'reads', 'extraPackages', 'grammar', 'backing', 'dbFunctions', 'sqlPassThrough', 'engineOwned', 'ddlRenderers'].includes(key)) bad.push(`${at} has unknown key ${key}`);
  if (value.dbFunctions !== undefined && (side !== 'be' || !dbFunctionsOk(value.dbFunctions, { bare: true }))) bad.push(`${at}.dbFunctions belongs to the be side and lists {name, reason} database functions, each schema-qualified (schema.name, never pg_catalog) or a bare pg built-in of the canon's list, with unique names`);
  if (value.sqlPassThrough !== undefined && (side !== 'be' || !sqlPassThroughOk(value.sqlPassThrough))) bad.push(`${at}.sqlPassThrough belongs to the be side and lists {file, reason} files relative to the side folder, forward slashes, unique, each with the reason its SQL text is not the app's own`);
  if (value.ddlRenderers !== undefined && (side !== 'be' || !ddlRenderersOk(value.ddlRenderers))) bad.push(`${at}.ddlRenderers belongs to the be side and lists {path, reason} files of a root package (packages/<name>/..., relative to the app root, forward slashes, a * only in the file name), unique, each with the reason it renders DDL text that a cli command writes as a new migration`);
  if (value.engineOwned !== undefined && (side !== 'be' || !engineOwnedOk(value.engineOwned))) bad.push(`${at}.engineOwned belongs to the be side and is { capability (kebab-case folder), tables (snake_case, unique), partitionsOf (one of tables), views (a prefix pattern such as v_*), manifest (a relative .json path below the app root) }`);
  bad.push(...appShapeProblems(value.apps, at, side, names));
  if (isBadUniqueList(value.optionalSlots, (slot: Parsed) => SLOT_ID.test(String(slot)))) bad.push(`${at}.optionalSlots must be a unique list of slot ids`);
  if (value.backing !== undefined && side !== 'be') bad.push('backing belongs to the be side');
  else if (isBadUniqueList(value.backing, (name: Parsed) => NAME.test(String(name)))) bad.push(`${at}.backing must be a unique list of backing service names`);
  bad.push(...patternShapeProblems(value, at, NAME), ...kindShapeProblems(value, at, NAME));
  if (isBadUniqueList(value.reads, (read: Parsed) => typeof read === 'string' && read.length > 0)) bad.push(`${at}.reads must be a unique list of paths`);
  if (value.connections !== undefined) bad.push(...connectionProblems(side, value));
  bad.push(...extraPackageProblems(side, value.extraPackages), ...grammarProblems(side, value.grammar));
  return bad;
}

/** Product vocabulary is a declaration, never a switch for a rule. */
function lexiconBlockProblems(lexicon: Parsed): string[] {
  if (lexicon === undefined) return [];
  if (!isPlainObject(lexicon)) return ['lexicon must be an object'];
  const bad: string[] = [];
  for (const key of Object.keys(lexicon)) if (key !== 'removed') bad.push(`lexicon has unknown key ${key}`);
  if (isBadUniqueList(lexicon.removed, (word: Parsed) => typeof word === 'string' && word.trim().length > 0)) bad.push('lexicon.removed must be a unique list of nonempty words');
  return bad;
}

/** Front-end error reporting remains optional in both editions. */
function observeBlockProblems(observe: Parsed): string[] {
  if (observe === undefined) return [];
  if (!isPlainObject(observe)) return ['observe must be an object'];
  const bad: string[] = [];
  for (const key of Object.keys(observe)) if (key !== 'reporter') bad.push(`observe has unknown key ${key}`);
  if (observe.reporter !== undefined && (typeof observe.reporter !== 'string' || !observe.reporter.trim())) bad.push('observe.reporter must name the optional error reporter');
  return bad;
}

const DECLARATION_KEYS = new Set(['hfs', 'kind', 'project', 'edition', 'db', 'sides', 'browser', 'modules', 'lexicon', 'observe', 'rulePacks', 'checks']);
/** A rule pack hfs.json names (PROJECT-LINT-3): an npm package name, each once. */
const RULE_PACK_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
/** A project check's id (kebab-case) and its file: a `.mjs` file of slot app.checks, `scripts/checks/<name>.mjs` (PROJECT-LINT-3, R402). */
const CHECK_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CHECK_RUN = /^scripts\/checks\/[a-z0-9][a-z0-9._-]*\.mjs$/u;

/** A project check is {id, run, why}: a unique kebab-case id, a unique file of scripts/checks/, and the reason the project keeps it. */
function checksBlockProblems(checks: Parsed): string[] {
  if (checks === undefined) return [];
  const shape = 'checks is a non-empty list of {id, run, why}: a unique kebab-case id, run a unique scripts/checks/<name>.mjs file (slot app.checks) and why the project keeps the check, nothing else (PROJECT-LINT-3)';
  if (!Array.isArray(checks) || checks.length === 0) return [shape];
  const bad = checks.some((check: Parsed) => !isPlainObject(check) || Object.keys(check).some((key) => !['id', 'run', 'why'].includes(key)) || !CHECK_ID.test(String(check.id)) || !CHECK_RUN.test(String(check.run)) || typeof check.why !== 'string' || check.why.trim() === '');
  const unique = new Set(checks.map((check: Parsed) => check?.id)).size === checks.length && new Set(checks.map((check: Parsed) => check?.run)).size === checks.length;
  return bad || !unique ? [shape] : [];
}
const RUNTIME_DECLARATION_KEYS = new Set(['hfs', 'kind', 'project']);

function productDeclarationProblems(declaration: Parsed, profiles: Parsed): string[] {
  const bad: string[] = [];
  for (const key of Object.keys(declaration)) if (!DECLARATION_KEYS.has(key)) bad.push(`unknown key ${key}`);
  bad.push(...dbBlockProblems(declaration.db), ...lexiconBlockProblems(declaration.lexicon), ...observeBlockProblems(declaration.observe), ...checksBlockProblems(declaration.checks));
  if (declaration.browser !== undefined && declaration.browser !== true) bad.push('browser is `true` when the app has a browser journey (slot app.browser), and is left out otherwise');
  if (declaration.rulePacks !== undefined && (!Array.isArray(declaration.rulePacks) || declaration.rulePacks.length === 0 || declaration.rulePacks.some((name: Parsed) => typeof name !== 'string' || !RULE_PACK_NAME.test(name)) || new Set(declaration.rulePacks).size !== declaration.rulePacks.length)) bad.push('rulePacks is a non-empty list of the installed rule pack packages the app adds its laws with, each once (PROJECT-LINT-3)');
  if (declaration.modules !== undefined && declaration.modules !== 'data') bad.push('modules is `"data"` when the app keeps its modules as data (seeds, no rendered registry package), and is left out otherwise');
  if (declaration.kind !== APP_KIND) bad.push(`kind must be ${APP_KIND} (a product is one app repository of the sides it declares) or ${RUNTIME_KIND} (the StarCi runtime repository)`);
  const sides = sidesProblems(declaration.sides);
  if (sides.length) { bad.push(...sides); return bad; }
  const names = new Map();
  for (const side of profiles) if (Object.hasOwn(declaration.sides, side)) bad.push(...declarationSideProblems(side, declaration.sides[side], names));
  bad.push(...crossSideReadProblems(declaration.sides));
  return bad;
}

/** PROJECT-1: `sides` declares a non-empty subset of be, fe and packages; `packages` is the empty object `{}` (the root workspace packages/*). */
function sidesProblems(sides: Parsed): string[] {
  if (!isPlainObject(sides)) return [`sides must be an object declaring some of ${PROJECT_SIDES.join(', ')}`];
  const keys = Object.keys(sides).sort(byCodeUnit);
  const bad = keys.filter((key) => !isProjectSide(key)).map((key) => `sides.${key} is not a side (a project declares some of ${PROJECT_SIDES.join(', ')})`);
  if (!keys.length) bad.push(`sides is empty: a project declares at least one of ${PROJECT_SIDES.join(', ')}`);
  if (Object.hasOwn(sides, 'packages') && !(isPlainObject(sides.packages) && Object.keys(sides.packages).length === 0)) bad.push('sides.packages is the empty object {} (it declares the root workspace packages/*)');
  return bad;
}

/** A side reads only a declared side: a `reads` path below be/ or fe/ names a side hfs.json declares. */
function crossSideReadProblems(sides: Parsed): string[] {
  const bad: string[] = [];
  for (const side of ['be', 'fe']) {
    const reads = Array.isArray(sides[side]?.reads) ? sides[side].reads : [];
    for (const read of reads) {
      const head = typeof read === 'string' ? read.split('/')[0] : '';
      if (head !== side && isProjectSide(head) && !Object.hasOwn(sides, head)) bad.push(`sides.${side}.reads names ${read}, but the project does not declare the ${head} side`);
    }
  }
  return bad;
}

/** Shape problems of a parsed hfs.json, in the words of modules/schemas/hfs-repo.schema.yaml. */
export function declarationShapeProblems(declaration: Parsed, profiles: Parsed): string[] {
  const bad: string[] = [];
  if (!isPlainObject(declaration)) return ['hfs.json is not an object'];
  if (!(Number.isInteger(declaration.hfs) && declaration.hfs >= 1)) bad.push('hfs must be the pinned manifest major (an integer, 1 or more)');
  if (!NAME.test(String(declaration.project))) bad.push('project must be a project name');
  if (declaration.kind === RUNTIME_KIND) {
    for (const key of Object.keys(declaration)) if (!RUNTIME_DECLARATION_KEYS.has(key)) bad.push(`unknown key ${key} (a runtime declaration is {hfs, kind, project})`);
    return bad;
  }
  bad.push(...productDeclarationProblems(declaration, profiles));
  return bad;
}
