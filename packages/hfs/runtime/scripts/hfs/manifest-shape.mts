// manifest-shape.mjs - the shape rules of an HFS slot manifest that both manifest kinds share, and the whole shape of a
// manifest of kind runtime (knowledge/hfs/runtime-slots.yaml): the slot fields, the tier map and ruleParams.runtime.
// scripts/hfs/slots.mjs (loadSlotManifest) is the only reader; it adds the app kind's own rules
// (sides, app kinds) and refuses a manifest whole on any problem (HFS_MANIFEST_INVALID). Pure: every function takes a
// parsed manifest or slot and returns a list of problems in the words of modules/schemas/hfs-slots.schema.yaml.
import { isPlainObject } from '../../engine/plain-object.mjs';
import { stringList, byCodeUnit, nonemptyUniqueList } from '../lib/list.mjs';

// reason: a manifest or declaration parsed from YAML/JSON on disk; the shape validators of this folder are what check (and so narrow) it
export type Parsed = any;

export type SlotPresence = 'required' | 'optional' | 'opt-in' | 'forbidden';
export type SlotTracking = 'tracked' | 'ignored' | 'external' | 'generated';
export type SlotTests = 'unit-beside' | 'e2e' | 'none';
export type SlotCoverage = 'required' | 'none';

/** A reference to the file that exemplifies a slot: a path, or a path limited to one edition or a few. */
export type SlotEvidenceRef = string | { path: string; edition?: string; editions?: string[] };

/** The fields a slot's `lite` overlay may hold: the same keys it would carry in the slot body, resolved under edition lite. */
export interface SlotLiteOverlay {
  path?: string;
  requires?: string[];
  allows?: string[];
  forbids?: string[];
  minInstances?: number;
  requiredInstances?: Record<string, string[]>;
  why?: string;
}

/** One slot of the manifest (knowledge/hfs/slots.yaml, or runtime-slots.yaml for kind runtime), as the loader validated it. */
export interface Slot {
  id: string;
  profiles: string[];
  path: string;
  presence: SlotPresence;
  tracked: SlotTracking;
  tier: string;
  tests: SlotTests;
  owner?: boolean;
  appKind?: string;
  minInstances?: number;
  requiredWhen?: string;
  requiredInstances?: Record<string, string[]>;
  requires?: string[];
  pattern?: string;
  trigger?: string;
  allows?: string[];
  forbids?: string[];
  layers?: string[];
  kinds?: string[];
  roles?: Record<string, string>;
  composedBy?: string[];
  budget?: Record<string, number>;
  managedBy?: string;
  liteManagedBy?: string;
  rules?: string[];
  goesTo?: string;
  why?: string;
  since?: string;
  perConnection?: string[];
  parent?: string;
  editions?: string[];
  editionWhy?: string;
  litePresence?: SlotPresence | Record<string, SlotPresence>;
  lite?: SlotLiteOverlay;
  provider?: string;
  coverage?: SlotCoverage;
  entries?: string[];
  outcomeHome?: boolean;
  templateNa?: string;
  exemplifiedBy?: SlotEvidenceRef[];
  role?: string;
  importedBy?: string[];
  rewrittenBy?: string;
  logic?: string[];
  generatedBy?: string;
}

/** One tier of the direction matrix of a profile. */
export interface TierDef {
  mayImport: string[];
  mayImportKinds?: Record<string, { from: string[]; to: string[] }>;
  mayImportSlots?: Record<string, { from: string[] }>;
  acyclic?: boolean;
  lowerLayerOnly?: boolean;
}

/** A unit-tested role of a back end (ruleParams.be.unitRoles). */
export interface UnitRole {
  role: string;
  spec: string;
  slot?: string;
  exempt?: string[];
}

/** A database function an app or the canon lists (ruleParams.be.dbFunctions, hfs.json sides.be.dbFunctions). */
export interface DbFunction {
  name: string;
  reason: string;
}

/** A file whose `.query(` passes through SQL text that is not the app's own (ruleParams.be.sqlPassThrough, hfs.json sides.be.sqlPassThrough). */
export interface SqlPassThrough {
  file: string;
  reason: string;
}

/** The rule parameters of one profile (ruleParams.common merged with ruleParams.<profile>); the keys not named here are parsed manifest data. */
export interface RuleParams {
  // reason: ruleParams entries are parsed YAML read by key from many rules; the shape validators check them
  [key: string]: Parsed;
  fileLines?: { soft: number; hardGrowth: boolean };
  duplicateBlock?: { lines: number; tokens: number };
  logicRoles?: string[];
  suffixes?: string[];
  bannedSuffixes?: string[];
  dbFunctions?: DbFunction[];
  sqlPassThrough?: SqlPassThrough[];
}

/** ruleParams.be: the back end's own parameters, which the validators of this folder require. */
export interface BeRuleParams extends RuleParams {
  unitRoles: UnitRole[];
  logicRoles: string[];
  suffixes: string[];
  bannedSuffixes: string[];
}

/** The `ruleParams` of a manifest, by profile; `common` is shared and `lite` overrides live inside each profile. */
export interface ManifestRuleParams {
  [profile: string]: RuleParams | undefined;
  common: RuleParams;
  be: BeRuleParams;
}

/** The parsed and validated slot manifest of loadSlotManifest, with the numeric parts of `version` added. */
export interface SlotManifest {
  schema: string;
  kind?: string;
  version: string;
  major: number;
  minor: number;
  patch: number;
  editions?: string[];
  sides: Record<string, { reads: string[] }>;
  appKinds: Record<string, string[]>;
  triggerKinds?: string[];
  tiers: Record<string, Record<string, TierDef>>;
  ruleParams: ManifestRuleParams;
  slots: Slot[];
  consumers?: string[];
  crossOwner?: string;
  crossApp?: string;
}

export const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
export const NAME = /^[a-z][a-z0-9-]*$/;
/** An npm package name, scoped or not. */
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const ENV_PREFIX =/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
/** How a bounded context (a connection) is isolated: its own logical database, or its own schema of a shared one. */
const CONTEXT_ISOLATIONS = Object.freeze(["database", "schema"]);
/** The app kinds that may own a context: the services, never the migrate or cli apps that only run migrations. */
const CONTEXT_OWNER_KINDS = Object.freeze(["api", "worker"]);
/** The database engine a connection runs on. */
const CONNECTION_PROVIDERS = Object.freeze(["postgres"]);
/** The editions an app repository may declare in hfs.json (`full` when absent): the filter slots.mjs applies. */
export const EDITIONS = Object.freeze(["full", "lite"]);
/** What decides where schema changes live (ruleParams.<side>.schemaAuthority): TypeORM migrations under persistence/, or the SQL migration tree db/migrations. */
export const SCHEMA_AUTHORITIES = Object.freeze(["typeorm", "sql"]);
/**
 * The shape problems of the `connections` of one side: a list of {name, envPrefix, owner, isolation}, the owner an api or worker app
 * of the same side (a connection is a bounded context and one service owns it), isolation `database` or `schema`.
 *
 * @param {unknown} list - The declared connections (null when it is not an array).
 * @param {unknown} apps - The declared apps of the same side.
 * @returns {string[]} The problems, none when the shape is right.
 */
export function connectionShapeProblems(list: Parsed, apps: Parsed): string[] {
  const keys = (c: Parsed) => isPlainObject(c) && NAME.test(String(c.name)) && ENV_PREFIX.test(String(c.envPrefix)) && NAME.test(String(c.owner)) && CONTEXT_ISOLATIONS.includes(c.isolation)
    && (c.provider === undefined || CONNECTION_PROVIDERS.includes(c.provider))
    && Object.keys(c).every((k: Parsed) => ['name', 'envPrefix', 'owner', 'isolation', 'provider'].includes(k)) && ['name', 'envPrefix', 'owner', 'isolation'].every((k: Parsed) => k in c);
  if (!list?.every(keys)) return [`connections must be a list of {name: kebab-case context name, envPrefix: UPPER_SNAKE prefix of its env keys, owner: the service app that owns the context, isolation: ${CONTEXT_ISOLATIONS.join(' | ')}, provider?: ${CONNECTION_PROVIDERS.join(' | ')}}`];
  const owns = (c: Parsed) => Array.isArray(apps) && apps.some((app: Parsed) => isPlainObject(app) && app.name === c.owner && CONTEXT_OWNER_KINDS.includes(app.kind));
  return list.filter((c: Parsed) => !owns(c)).map((c: Parsed) => `connections ${c.name} is owned by ${c.owner}, which is not a ${CONTEXT_OWNER_KINDS.join(' or ')} app declared in the same side`);
}
export const SLOT_ID = /^(app|repo|be|fe)\.[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const RUNTIME_SLOT_ID = /^runtime\.[a-z0-9-]+(\.[a-z0-9-]+)*$/;
export const PRESENCE = ['required', 'optional', 'opt-in', 'forbidden'];
export const TRACKED = ['tracked', 'ignored', 'external'];
/** A runtime manifest adds `generated`: tracked, written only by the slot's generatedBy, judged by drift (RT_GENERATED_DRIFT). */
const RUNTIME_TRACKED = [...TRACKED, 'generated'];
export const TESTS = ['unit-beside', 'e2e', 'none'];
/** The coverage mode of a tracked slot of the be profile or of a runtime manifest (scripts/hfs/coverage-scope.mjs and scripts/hfs/runtime-coverage-scope.mjs derive the coverage consumers from it). */
export const COVERAGE = ['required', 'none'];
export const APP_KIND = 'app';

/**
 * The unit-tested roles of a back end whose spec is required (ruleParams.be.unitRoles of the slot manifest): [{ role, spec, slot?, exempt? }].
 * THE one list: every check that asks "is this file unit-tested, and where is its spec" asks it here. What the unit run MEASURES is
 * logicRoles over the coverage-required slots (coverage-scope.mjs), not this list.
 */
export const unitRolesOf = (manifest: SlotManifest): UnitRole[] => manifest.ruleParams.be.unitRoles;

/** The roles that carry logic (ruleParams.be.logicRoles): measured at 100 per file inside a coverage-required slot. */
export const logicRolesOf = (manifest: SlotManifest): string[] => manifest.ruleParams.be.logicRoles;

/** A declared logic file: `<name>.<part>.ts` below the slot path, kebab-case parts, no placeholder, glob or spec. */
const LOGIC_FILE = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+\.ts$/;

/** The role suffix of a file name (`passport.tokens.ts` gives `tokens`). */
export const suffixOf = (file: string): string | null => /\.([a-z0-9-]+)\.ts$/.exec(file)?.[1] ?? null;

/**
 * The files a slot declares as logic (`logic`, names relative to the slot path): a file that carries logic without a logic-role suffix.
 * Each is measured at 100 per file like a logic-role file (scripts/hfs/coverage-scope.mjs), and its `<stem>.spec.ts` beside it is a
 * legitimate unit spec its slot admits (scripts/hfs/allows.mjs, eslint-canon-be unit-test-colocated). No role name is added for it.
 */
export const declaredLogicOf = (slot: Pick<Slot, 'logic'> | null | undefined): string[] => (Array.isArray(slot?.logic) ? slot.logic : []);

/** The unit spec beside a declared logic file: `passport.tokens.ts` gives `passport.tokens.spec.ts`. */
export const declaredLogicSpecOf = (file: string): string => file.replace(/\.ts$/, '.spec.ts');

/**
 * Shape problems of a slot's `logic`: a non-empty list of unique `<name>.<part>.ts` files, each one the slot requires or allows by that
 * exact name, on a tracked directory slot of profile be that is coverage: required and unit-beside, and (given the logic roles) none
 * already of a logic role, which its role measures.
 */
export function slotLogicProblems(slot: Parsed, at: string, logicRoles: readonly unknown[] = []): string[] {
  if (slot.logic === undefined) return [];
  const list = slot.logic;
  if (!strList(list) || !list.length || new Set(list).size !== list.length || !list.every((file: Parsed) => LOGIC_FILE.test(file) && !file.endsWith('.spec.ts'))) return [`${at}: logic must be a non-empty list of unique <name>.<part>.ts files relative to the slot path`];
  const bad = [];
  const home = typeof slot.path === 'string' && slot.path.endsWith('/') && slot.tracked === 'tracked' && Array.isArray(slot.profiles) && slot.profiles.includes('be') && slot.coverage === 'required' && slot.tests === 'unit-beside';
  if (!home) bad.push(`${at}: logic belongs to a tracked directory slot of profile be whose coverage is required and whose tests are unit-beside`);
  const named = [...(slot.requires ?? []), ...(slot.allows ?? [])];
  for (const file of list.filter((entry: Parsed) => !named.includes(entry))) bad.push(`${at}: logic file ${file} must be one the slot requires or allows by that name`);
  for (const file of list.filter((entry: Parsed) => logicRoles.includes(suffixOf(entry)))) bad.push(`${at}: logic file ${file} is of the logic role ${suffixOf(file)}, which measures it already`);
  return bad;
}


/** Shape problems of ruleParams.be.unitRoles: unique roles of the suffix vocabulary, each spec `<role>.spec`. */
export function unitRolesProblems(be: Parsed): string[] {
  const roles = be.unitRoles;
  const roleOk = (r: Parsed) => r !== null && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).every((k: Parsed) => ['role', 'spec', 'slot', 'exempt'].includes(k)) && NAME.test(String(r.role)) && String(r.spec) === `${r.role}.spec` && (r.slot === undefined || /^be.[a-z0-9.-]+$/.test(String(r.slot))) && (r.exempt === undefined || (Array.isArray(r.exempt) && r.exempt.every((c: Parsed) => /^[A-Z][A-Z0-9_]+$/.test(String(c)))));
  if (!Array.isArray(roles) || !roles.length || !roles.every(roleOk) || new Set(roles.map((r: Parsed) => r.role)).size !== roles.length) return ['ruleParams.be.unitRoles must be a non-empty list of unique {role, spec: <role>.spec, slot?, exempt?: [rule codes]}'];
  if (Array.isArray(be.suffixes) && roles.some((r: Parsed) => !be.suffixes.includes(r.role))) return ['ruleParams.be.unitRoles names a role that is not in ruleParams.be.suffixes'];
  return [];
}

/** Shape problems of ruleParams.be.logicRoles, valueRoles and thinRoles: each a non-empty list of unique roles of the suffix vocabulary; every unit role is a logic role. */
export function roleListProblems(be: Parsed): string[] {
  const bad = [];
  for (const key of ['logicRoles', 'valueRoles', 'thinRoles']) {
    const list = be[key];
    if (!strList(list) || !list.length || new Set(list).size !== list.length || !list.every((role: Parsed) => NAME.test(role))) bad.push(`ruleParams.be.${key} must be a non-empty list of unique kebab-case roles`);
    else if (Array.isArray(be.suffixes) && list.some((role: Parsed) => !be.suffixes.includes(role))) bad.push(`ruleParams.be.${key} names a role that is not in ruleParams.be.suffixes`);
  }
  if (strList(be.valueRoles) && strList(be.logicRoles) && be.valueRoles.some((role: Parsed) => !be.logicRoles.includes(role))) bad.push('every ruleParams.be.valueRoles role is a logic role (ruleParams.be.logicRoles)');
  if (strList(be.logicRoles) && Array.isArray(be.unitRoles) && be.unitRoles.some((r: Parsed) => r?.slot === undefined && !be.logicRoles.includes(r?.role))) bad.push('every ruleParams.be.unitRoles role that is not tied to a slot is a logic role (ruleParams.be.logicRoles)');
  return bad;
}
/** The kind of a manifest and of a declaration that describes the StarCi runtime repository; also its one profile. */
export const RUNTIME_KIND = 'runtime';
export const MANIFEST_KINDS = [APP_KIND, RUNTIME_KIND];
/** The kind of a parsed manifest: `kind`, or app when absent (knowledge/hfs/slots.yaml carries none). */
export const manifestKind = (m: Parsed): string => (isPlainObject(m) && m.kind !== undefined ? m.kind : APP_KIND);
const strList = (v: Parsed) => stringList(v);

const APP_SLOT_KEYS = ['id', 'profiles', 'path', 'presence', 'tracked', 'tier', 'tests', 'owner', 'appKind', 'minInstances', 'requiredWhen', 'requiredInstances', 'requires', 'pattern', 'trigger', 'allows', 'forbids', 'layers', 'kinds', 'roles', 'composedBy', 'budget', 'managedBy', 'liteManagedBy', 'rules', 'goesTo', 'why', 'since', 'perConnection', 'parent', 'editions', 'editionWhy', 'litePresence', 'lite', 'provider', 'coverage', 'entries', 'outcomeHome', 'templateNa', 'exemplifiedBy', 'role', 'importedBy', 'rewrittenBy', 'logic'];
/** The roles a file slot may play that a rule reads (`role`): the entity registry of persistence.md BE-PERSISTENCE-3 (architecture/entity-registry.mjs). */
const SLOT_ROLES = ['entity-registry'];
/** The fields a slot's `lite` overlay may hold: the same keys it would carry in the slot body, resolved under edition lite. */
const LITE_OVERLAY_KEYS = ['path', 'requires', 'allows', 'forbids', 'minInstances', 'requiredInstances', 'why'];
/** A runtime slot has no app kind, side composition, layer or managed template; it may name the generator of a generated copy. */
const RUNTIME_SLOT_KEYS = ['id', 'profiles', 'path', 'presence', 'tracked', 'tier', 'tests', 'owner', 'minInstances', 'requires', 'allows', 'forbids', 'budget', 'rules', 'goesTo', 'why', 'since', 'generatedBy', 'parent', 'coverage'];

const isPositiveInt = (v: Parsed) => Number.isInteger(v) && v >= 1;
const instancesShapeOk = (v: Parsed) => isPlainObject(v) && Object.values(v).every((list: Parsed) => strList(list) && list.length);

const generatedByInvalid = (generatedBy: Parsed) => typeof generatedBy !== 'string' || !generatedBy || generatedBy.startsWith('/') || generatedBy.includes('..');

const profilesInvalid = (profiles: Parsed, appScope: Parsed, scopes: Parsed) => !Array.isArray(profiles) || !profiles.length || !profiles.every((p: Parsed) => scopes.includes(p)) || new Set(profiles).size !== profiles.length || (profiles.includes(appScope) && profiles.length !== 1);

function runtimeIdentityProblems(slot: Parsed, at: string): string[] {
  const bad = [];
  if (!RUNTIME_SLOT_ID.test(String(slot.id))) bad.push(`${at}: id must look like runtime.<name>`);
  if (JSON.stringify(slot.profiles) !== JSON.stringify([RUNTIME_KIND])) bad.push(`${at}: profiles must be [runtime]`);
  if (slot.tracked === 'generated' && generatedByInvalid(slot.generatedBy)) bad.push(`${at}: a generated slot names its generator (generatedBy, a repository-relative path)`);
  if (slot.generatedBy !== undefined && slot.tracked !== 'generated') bad.push(`${at}: generatedBy belongs to a generated slot`);
  return bad;
}

function appIdentityProblems(slot: Parsed, at: string, appScope: string, scopes: string[]): string[] {
  const bad = [];
  if (!SLOT_ID.test(String(slot.id))) bad.push(`${at}: id must look like be.transport.http`);
  if (profilesInvalid(slot.profiles, appScope, scopes)) bad.push(`${at}: profiles must be [app] or a unique non-empty subset of be, fe`);
  else if ((slot.profiles[0] === appScope) !== String(slot.id).startsWith(`${appScope}.`)) bad.push(`${at}: an app-root slot has profiles [app] and an id app.<name>, and only it`);
  if (slot.rewrittenBy !== undefined && (typeof slot.rewrittenBy !== 'string' || !slot.rewrittenBy.trim() || slot.tracked !== 'ignored' || String(slot.path).endsWith('/'))) bad.push(`${at}: rewrittenBy names the dev server that writes the files of an ignored file slot`);
  return bad;
}

/** Shape problems of one slot of a manifest of `kind` (app or runtime). */
function slotIdentityProblems(slot: Parsed, runtime: boolean, slotKeys: Set<string>, at: string, appScope: string, scopes: string[]): string[] {
  const bad = [];
  for (const key of Object.keys(slot)) if (!slotKeys.has(key)) bad.push(`${at}: unknown field ${key}`);
  bad.push(...(runtime ? runtimeIdentityProblems(slot, at) : appIdentityProblems(slot, at, appScope, scopes)));
  return bad;
}

function slotCoverageProblems(slot: Parsed, at: string, runtime: boolean): string[] {
  const bad = [];
  const measured = slot.tracked === 'tracked' && (runtime || (Array.isArray(slot.profiles) && slot.profiles.includes('be')));
  if (measured && !COVERAGE.includes(slot.coverage)) bad.push(`${at}: coverage must be one of ${COVERAGE.join(', ')} (every tracked slot of ${runtime ? 'a runtime manifest' : 'the be profile'} declares it)`);
  if (!measured && slot.coverage !== undefined) bad.push(`${at}: coverage belongs to a tracked slot of ${runtime ? 'a runtime manifest' : 'the be profile'} only`);
  return bad;
}

function slotLocationProblems(slot: Parsed, at: string, runtime: boolean, tracked: string[]): string[] {
  const bad = [];
  if (typeof slot.path !== 'string' || !slot.path) bad.push(`${at}: path is required`);
  if (slot.parent !== undefined && !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(String(slot.parent))) bad.push(`${at}: parent must be a slot id`);
  if (!PRESENCE.includes(slot.presence)) bad.push(`${at}: presence must be one of ${PRESENCE.join(', ')}`);
  if (!tracked.includes(slot.tracked)) bad.push(`${at}: tracked must be one of ${tracked.join(', ')}`);
  if (!NAME.test(String(slot.tier))) bad.push(`${at}: tier must be a tier name, none or inherit`);
  if (!TESTS.includes(slot.tests)) bad.push(`${at}: tests must be one of ${TESTS.join(', ')}`);
  if (slot.owner !== undefined && typeof slot.owner !== 'boolean') bad.push(`${at}: owner must be a boolean`);
  bad.push(...slotCoverageProblems(slot, at, runtime));
  return bad;
}

const NAMED_SLOT_FIELDS: Array<[string, string]> = [['appKind', 'appKind must be a name'], ['trigger', 'trigger must be a trigger kind name'], ['pattern', 'pattern must be a pattern name']];

function slotInstanceProblems(slot: Parsed, at: string): string[] {
  const bad = [];
  if (slot.pattern !== undefined && !/^[a-z][a-z0-9-]*$/.test(String(slot.pattern))) bad.push(`${at}: pattern must be a kebab-case pattern name`);
  if (slot.requiredInstances !== undefined && !instancesShapeOk(slot.requiredInstances)) bad.push(`${at}: requiredInstances must map a variable to a non-empty list of names`);
  return bad;
}

function slotPatternProblems(slot: Parsed, at: string): string[] {
  const bad = [];
  for (const [key, what] of NAMED_SLOT_FIELDS) if (slot[key] !== undefined && !NAME.test(String(slot[key]))) bad.push(`${at}: ${what}`);
  if (slot.minInstances !== undefined && !isPositiveInt(slot.minInstances)) bad.push(`${at}: minInstances must be a positive integer`);
  if (slot.requiredWhen !== undefined && slot.requiredWhen !== 'connections') bad.push(`${at}: requiredWhen may only be connections`);
  bad.push(...slotInstanceProblems(slot, at));
  return bad;
}

const kindsInvalid = (slot: Parsed) => {
  if (slot.kinds === undefined || !strList(slot.kinds)) return false;
  return !slot.kinds.length || new Set(slot.kinds).size !== slot.kinds.length || slot.kinds.some((k: Parsed) => !NAME.test(k) || (slot.layers ?? []).includes(k));
};
const rolesValid = (roles: Parsed) => isPlainObject(roles) && Object.keys(roles).length && Object.entries(roles).every(([role, file]) => NAME.test(role) && typeof file === 'string' && file && !file.includes('/'));
const composedByValid = (list: Parsed) => strList(list) && list.length && new Set(list).size === list.length;
const budgetValid = (budget: Parsed) => isPlainObject(budget) && Object.keys(budget).length && Object.values(budget).every(isPositiveInt);

function slotListProblems(slot: Parsed, at: string): string[] {
  const bad = [];
  for (const key of ['requires', 'allows', 'forbids', 'layers', 'kinds']) if (slot[key] !== undefined && !strList(slot[key])) bad.push(`${at}: ${key} must be a list of strings`);
  if (kindsInvalid(slot)) bad.push(`${at}: kinds must be a non-empty list of unique folder names that are not layers`);
  if (slot.roles !== undefined && !rolesValid(slot.roles)) bad.push(`${at}: roles must map a role name to a file name`);
  if (slot.composedBy !== undefined && !composedByValid(slot.composedBy)) bad.push(`${at}: composedBy must be a non-empty list of unique app kinds`);
  if (slot.budget !== undefined && !budgetValid(slot.budget)) bad.push(`${at}: budget must map names to positive integers`);
  for (const key of ['managedBy', 'liteManagedBy']) if (slot[key] !== undefined && !NAME.test(String(slot[key]))) bad.push(`${at}: ${key} must be a template id`);
  return bad;
}

function slotAppOptionProblems(slot: Parsed, at: string): string[] {
  const bad = [];
  bad.push(...slotEditionWhyProblems(slot, at), ...slotCoverageEvidenceProblems(slot, at));
  // Legacy coverage status derives only from an explicit `since`; a slot that omits it is refused, so a new slot can never be taken for an old one.
  if (slot.since === undefined) bad.push(`${at}: since is required (the manifest version that added the slot)`);
  if (slot.editions !== undefined && !(Array.isArray(slot.editions) && slot.editions.length && slot.editions.every((e: Parsed) => EDITIONS.includes(e)) && new Set(slot.editions).size === slot.editions.length)) bad.push(`${at}: editions must be a non-empty subset of ${EDITIONS.join(', ')}`);
  if (slot.litePresence !== undefined && !(PRESENCE.includes(slot.litePresence) || (isPlainObject(slot.litePresence) && Object.keys(slot.litePresence).length && Object.entries(slot.litePresence).every(([side, value]: [string, Parsed]) => ['be', 'fe'].includes(side) && PRESENCE.includes(value))))) bad.push(`${at}: litePresence must be a presence value or map sides to presence values`);
  if (slot.provider !== undefined) {
    if (!CONNECTION_PROVIDERS.includes(slot.provider)) bad.push(`${at}: provider must be one of ${CONNECTION_PROVIDERS.join(' | ')}`);
    else if (slot.presence !== 'opt-in' || slot.appKind !== undefined) bad.push(`${at}: provider belongs to an opt-in slot that is not an app kind (a connection with that provider enables it)`);
  }
  return bad;
}

function slotEditionWhyProblems(slot: Parsed, at: string): string[] {
  if (slot.editionWhy === undefined) return [];
  return typeof slot.editionWhy === 'string' && slot.editionWhy.trim()
    ? [] : [`${at}: editionWhy must be non-empty text`];
}

const slotEvidencePathValid = (value: Parsed) => relPath(value) && /^[^\s]+$/.test(value);

function slotEvidenceRefValid(ref: Parsed) {
  if (typeof ref === 'string') return slotEvidencePathValid(ref);
  if (!isPlainObject(ref) || !slotEvidencePathValid(ref.path)) return false;
  if (!Object.keys(ref).every((key: Parsed) => ['path', 'edition', 'editions'].includes(key))) return false;
  if (ref.edition !== undefined && !EDITIONS.includes(ref.edition)) return false;
  if (ref.editions !== undefined && !nonemptyUniqueList(ref.editions, (edition: Parsed) => EDITIONS.includes(edition))) return false;
  return ref.edition === undefined || ref.editions === undefined;
}

const slotEvidenceRefKey = (ref: Parsed) => typeof ref === 'string' ? ref
  : JSON.stringify([ref.path, ref.edition, ref.editions]);

function slotCoverageEvidenceProblems(slot: Parsed, at: string): string[] {
  const bad = [];
  if (slot.templateNa !== undefined && !(typeof slot.templateNa === 'string' && slot.templateNa.trim()))
    bad.push(`${at}: templateNa must be non-empty text`);
  if (slot.exemplifiedBy === undefined) return bad;
  const refs = slot.exemplifiedBy;
  const valid = Array.isArray(refs) && refs.length > 0 && refs.every(slotEvidenceRefValid)
    && new Set(refs.map(slotEvidenceRefKey)).size === refs.length;
  if (!valid) bad.push(`${at}: exemplifiedBy must be unique repository-relative paths or {path, edition? | editions?} references`);
  return bad;
}

function slotLiteOverlayProblems(slot: Parsed, at: string): string[] {
  if (slot.lite === undefined) return [];
  const ok = isPlainObject(slot.lite) && Object.keys(slot.lite).length && Object.keys(slot.lite).every((key: Parsed) => LITE_OVERLAY_KEYS.includes(key))
    && (slot.lite.path === undefined || (typeof slot.lite.path === 'string' && slot.lite.path))
    && (slot.lite.why === undefined || (typeof slot.lite.why === 'string' && slot.lite.why.trim()))
    && ['requires', 'allows', 'forbids'].every((key: Parsed) => slot.lite[key] === undefined || strList(slot.lite[key]))
    && (slot.lite.minInstances === undefined || (Number.isInteger(slot.lite.minInstances) && slot.lite.minInstances >= 1))
    && (slot.lite.requiredInstances === undefined || (isPlainObject(slot.lite.requiredInstances) && Object.values(slot.lite.requiredInstances).every((v: Parsed) => strList(v) && v.length)));
  return ok ? [] : [`${at}: lite may hold only ${LITE_OVERLAY_KEYS.join(', ')}, each shaped as in the slot body`];
}

function slotEntryProblems(slot: Parsed, at: string): string[] {
  const bad = [];
  if (slot.entries !== undefined) {
    const listed = strList(slot.entries) && slot.entries.length > 0 && new Set(slot.entries).size === slot.entries.length && slot.entries.every(relPath);
    if (!listed) bad.push(`${at}: entries must be a non-empty list of unique relative file paths`);
    else if (typeof slot.path !== 'string' || !slot.path.endsWith('/')) bad.push(`${at}: entries belong to a directory slot (they name its explicit public API files)`);
    else if (Array.isArray(slot.allows) && slot.entries.some((entry: Parsed) => !slot.allows.includes(entry))) bad.push(`${at}: every entry must be one of the names the slot allows`);
  }
  if (slot.outcomeHome !== undefined && !(slot.outcomeHome === true && typeof slot.path === 'string' && slot.path && !slot.path.endsWith('/'))) bad.push(`${at}: outcomeHome is true and belongs to a file slot (the one file that declares the repository's Outcome union)`);
  if (slot.role !== undefined && !(SLOT_ROLES.includes(slot.role) && typeof slot.path === 'string' && slot.path && !slot.path.endsWith('/'))) bad.push(`${at}: role is one of ${SLOT_ROLES.join(', ')} and belongs to a file slot`);
  if (slot.importedBy !== undefined && !(slot.role !== undefined && strList(slot.importedBy) && slot.importedBy.length && new Set(slot.importedBy).size === slot.importedBy.length && slot.importedBy.every(relPath))) bad.push(`${at}: importedBy is a non-empty list of unique relative path patterns of the only files that import the slot's file by deep path, on a slot with a role`);
  return bad;
}

function slotPolicyProblems(slot: Parsed, at: string): string[] {
  const bad = [];
  if (slot.rules !== undefined && !(Array.isArray(slot.rules) && slot.rules.every((r: Parsed) => /^[A-Z][A-Z0-9_]*\*?$/.test(String(r))) && new Set(slot.rules).size === slot.rules.length)) bad.push(`${at}: rules must be unique rule ids`);
  if (slot.perConnection !== undefined && !(slot.id === 'be.persistence' && strList(slot.perConnection) && slot.perConnection.length && new Set(slot.perConnection).size === slot.perConnection.length && slot.perConnection.every((name: Parsed) => NAME.test(name)))) bad.push(`${at}: perConnection is a unique list of capability names, only on be.persistence (the platform capabilities whose tables exist on every connection that uses them)`);
  if (slot.since !== undefined && !SEMVER.test(String(slot.since))) bad.push(`${at}: since must be a version`);
  if (slot.tracked === 'external' && (typeof slot.goesTo !== 'string' || slot.presence !== 'forbidden')) bad.push(`${at}: an external slot is forbidden and says where it goes (goesTo)`);
  if (slot.presence === 'forbidden' && slot.tracked !== 'external') bad.push(`${at}: a forbidden slot is external`);
  return bad;
}

export function slotProblems(slot: Parsed, index: number, kind: string, { appScope = 'app', scopes = [], logicRoles = [] }: { appScope?: string; scopes?: string[]; logicRoles?: readonly unknown[] } = {}): string[] {
  const runtime = kind === RUNTIME_KIND;
  const slotKeys = new Set(runtime ? RUNTIME_SLOT_KEYS : APP_SLOT_KEYS);
  const tracked = runtime ? RUNTIME_TRACKED : TRACKED;
  const at = isPlainObject(slot) && typeof slot.id === 'string' ? `slot ${slot.id}` : `slots[${index}]`;
  if (!isPlainObject(slot)) return [`${at} is not a map`];
  const bad = slotIdentityProblems(slot, runtime, slotKeys, at, appScope, scopes);
  bad.push(...slotLocationProblems(slot, at, runtime, tracked), ...slotPatternProblems(slot, at), ...slotListProblems(slot, at));
  if (!runtime) bad.push(...slotAppOptionProblems(slot, at), ...slotLiteOverlayProblems(slot, at));
  bad.push(...slotEntryProblems(slot, at), ...slotPolicyProblems(slot, at));
  if (!runtime) bad.push(...slotLogicProblems(slot, at, logicRoles));
  return bad;
}

/** The owners of an external call in a runtime manifest: an api system folder (`api/<system>`, `api/*` any system) or the DB tier. */
const INFRA_OWNER = /^(?:api\/(?:\*|[a-z][a-z0-9-]*)|engine\/db)$/;
const RUNTIME_PARAM_KEYS = new Set(['fileLines', 'sourceRoots', 'infraOwners', 'baseWriteMembers', 'baseEnvSeams', 'apiContracts', 'sourceName', 'oneOffNames', 'sharedBasenames', 'generated', 'heldSecrets', 'pinned', 'selfChecks']);
const relPath = (v: Parsed) => typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !v.includes('..') && !v.includes('\\');

function runtimeHeaderProblems(m: Parsed): string[] {
  const bad = [];
  const allowed = new Set(['schema', 'kind', 'version', 'versioning', 'presenceValues', 'trackedValues', 'testValues', 'profiles', 'tiers', 'ruleParams', 'crossOwner', 'crossSystem', 'slots', 'consumers']);
  for (const key of Object.keys(m)) if (!allowed.has(key)) bad.push(`unknown top-level key ${key}`);
  if (!/^starci\/runtime-slots@\d+$/.test(String(m.schema))) bad.push('schema must be starci/runtime-slots@<major>');
  if (!SEMVER.test(String(m.version))) bad.push('version must be MAJOR.MINOR.PATCH');
  if (!isPlainObject(m.versioning) || !['patch', 'minor', 'major', 'pins'].every((k: Parsed) => typeof m.versioning[k] === 'string')) bad.push('versioning needs patch, minor, major and pins text');
  if (JSON.stringify(m.presenceValues) !== JSON.stringify(PRESENCE)) bad.push(`presenceValues must be ${PRESENCE.join(', ')}`);
  if (JSON.stringify(m.trackedValues) !== JSON.stringify(RUNTIME_TRACKED)) bad.push(`trackedValues must be ${RUNTIME_TRACKED.join(', ')}`);
  if (JSON.stringify(m.testValues) !== JSON.stringify(TESTS)) bad.push(`testValues must be ${TESTS.join(', ')}`);
  if (JSON.stringify(m.profiles) !== JSON.stringify([RUNTIME_KIND])) bad.push('profiles must be [runtime]');
  return bad;
}

function runtimeSectionsProblems(m: Parsed): string[] {
  const bad = [];
  for (const key of ['crossOwner', 'crossSystem']) if (m[key] !== undefined && typeof m[key] !== 'string') bad.push(`${key} must be text`);
  if (!isPlainObject(m.tiers) || Object.keys(m.tiers).join() !== RUNTIME_KIND) bad.push('tiers must be a map with exactly runtime');
  else bad.push(...tierMapProblems(RUNTIME_KIND, m.tiers.runtime));
  const rp = m.ruleParams;
  if (!isPlainObject(rp) || Object.keys(rp).join() !== RUNTIME_KIND || !isPlainObject(rp.runtime)) bad.push('ruleParams must be a map with exactly runtime');
  else bad.push(...runtimeParamProblems(rp.runtime));
  if (!Array.isArray(m.slots) || !m.slots.length) bad.push('slots must be a non-empty list');
  else m.slots.forEach((slot: Parsed, index: number) => bad.push(...slotProblems(slot, index, RUNTIME_KIND)));
  if (m.consumers !== undefined && !strList(m.consumers)) bad.push('consumers must be a list of paths');
  return bad;
}

/** Shape problems of a parsed manifest of kind runtime (knowledge/hfs/runtime-slots.yaml), in the words of modules/schemas/hfs-slots.schema.yaml. */
export function runtimeShapeProblems(m: Parsed): string[] {
  return [...runtimeHeaderProblems(m), ...runtimeSectionsProblems(m)];
}

/** Shape problems of ruleParams.runtime. */
function runtimeParamKeyProblems(rp: Parsed): string[] {
  const bad = [];
  for (const key of Object.keys(rp)) if (!RUNTIME_PARAM_KEYS.has(key)) bad.push(`ruleParams.runtime.${key} is not a runtime parameter`);
  for (const key of RUNTIME_PARAM_KEYS) if (!(key in rp)) bad.push(`ruleParams.runtime.${key} is missing`);
  return bad;
}

function runtimeParamFoundationProblems(rp: Parsed): string[] {
  const bad = [];
  const fl = rp.fileLines;
  if (!(isPlainObject(fl) && Number.isInteger(fl.soft) && fl.soft >= 1 && typeof fl.hardGrowth === 'boolean' && Object.keys(fl).length === 2)) bad.push('ruleParams.runtime.fileLines must be {soft, hardGrowth}');
  const owners = rp.infraOwners;
  const ownerMap = (v: Parsed) => isPlainObject(v) && Object.entries(v).every(([key, list]) => key && Array.isArray(list) && list.every((o) => INFRA_OWNER.test(String(o))) && new Set(list).size === list.length);
  if (!isPlainObject(owners) || Object.keys(owners).sort(byCodeUnit).join() !== 'globals,modules,programs' || !['globals', 'modules', 'programs'].every((k: Parsed) => ownerMap(owners[k]))) bad.push('ruleParams.runtime.infraOwners must be {modules, globals, programs}, each mapping a name to unique owners api/<system>, api/* or engine/db ([] means nowhere)');
  return bad;
}

function runtimeParamListProblems(rp: Parsed): string[] {
  const bad = [];
  for (const key of ['sourceRoots', 'baseWriteMembers', 'oneOffNames', 'sharedBasenames']) if (!(strList(rp[key]) && rp[key].length && new Set(rp[key]).size === rp[key].length)) bad.push(`ruleParams.runtime.${key} must be a non-empty list of unique strings`);
  if (!(Array.isArray(rp.baseEnvSeams) && rp.baseEnvSeams.every(relPath))) bad.push('ruleParams.runtime.baseEnvSeams must be a list of repository-relative paths');
  if (!(isPlainObject(rp.apiContracts) && Object.entries(rp.apiContracts).every(([system, file]) => NAME.test(system) && relPath(file)))) bad.push('ruleParams.runtime.apiContracts must map an api system to its calls contract path');
  return bad;
}

function runtimeParamArtifactProblems(rp: Parsed): string[] {
  const bad = [];
  let sourceNameOk = typeof rp.sourceName === 'string';
  try { if (sourceNameOk) new RegExp(rp.sourceName); } catch { sourceNameOk = false; }
  if (!sourceNameOk) bad.push('ruleParams.runtime.sourceName must be a regular expression');
  if (!(Array.isArray(rp.generated) && rp.generated.length && rp.generated.every((g: Parsed) => isPlainObject(g) && relPath(g.root) && relPath(g.generatedBy) && Object.keys(g).length === 2))) bad.push('ruleParams.runtime.generated must be a non-empty list of {root, generatedBy}');
  if (!(Array.isArray(rp.pinned) && rp.pinned.length && rp.pinned.every((p: Parsed) => isPlainObject(p) && relPath(p.path) && typeof p.why === 'string' && p.why && Object.keys(p).length === 2))) bad.push('ruleParams.runtime.pinned must be a non-empty list of {path, why}');
  if (!(Array.isArray(rp.selfChecks) && rp.selfChecks.length && rp.selfChecks.every((c: Parsed) => isPlainObject(c) && NAME.test(String(c.id)) && relPath(c.run) && (c.args === undefined || strList(c.args)) && Object.keys(c).every((k: Parsed) => ['id', 'run', 'args'].includes(k))))) bad.push('ruleParams.runtime.selfChecks must be a non-empty list of {id, run, args?}');
  return bad;
}

function runtimeParamProblems(rp: Parsed): string[] {
  return [
    ...runtimeParamKeyProblems(rp),
    ...runtimeParamFoundationProblems(rp),
    ...runtimeParamListProblems(rp),
    ...runtimeParamArtifactProblems(rp),
  ];
}

const folderKindsValid = (list: Parsed) => strList(list) && list.length > 0 && new Set(list).size === list.length && list.every((kind: Parsed) => NAME.test(kind));
const kindPairValid = (pair: Parsed) => isPlainObject(pair) && Object.keys(pair).sort(byCodeUnit).join() === 'from,to'
  && ['from', 'to'].every(side => folderKindsValid(pair[side]));
/** A non-empty map whose every key is a name and every value satisfies `valid`. */
export const namedMapValid = (map: Parsed, valid: Parsed) => isPlainObject(map) && Object.keys(map).length > 0
  && Object.entries(map).every(([name, entry]) => NAME.test(name) && valid(entry));
const kindRestrictionValid = (kinds: Parsed) => namedMapValid(kinds, kindPairValid);
const slotIdsValid = (list: Parsed) => strList(list) && list.length > 0 && new Set(list).size === list.length
  && list.every((id: Parsed) => SLOT_ID.test(id) || RUNTIME_SLOT_ID.test(id));
const slotRestrictionPairValid = (pair: Parsed) => isPlainObject(pair) && Object.keys(pair).join() === 'from' && slotIdsValid(pair.from);
const slotRestrictionValid = (slots: Parsed) => namedMapValid(slots, slotRestrictionPairValid);

function tierDefinitionProblems(profile: string, tier: string, def: Parsed): string[] {
  const bad = [];
  const at = `tiers.${profile}.${tier}`;
  if (!isPlainObject(def) || !Array.isArray(def.mayImport) || !def.mayImport.every((t: Parsed) => NAME.test(String(t)))) bad.push(`${at}.mayImport must be a list of tier names`);
  if (def?.mayImportKinds !== undefined && !kindRestrictionValid(def.mayImportKinds)) bad.push(`${at}.mayImportKinds must map tier names to {from, to} non-empty lists of unique folder kinds`);
  if (def?.mayImportSlots !== undefined && !slotRestrictionValid(def.mayImportSlots)) bad.push(`${at}.mayImportSlots must map tier names to {from} non-empty lists of unique slot ids`);
  for (const key of Object.keys(def ?? {})) if (!['mayImport', 'mayImportKinds', 'mayImportSlots', 'acyclic', 'lowerLayerOnly'].includes(key)) bad.push(`${at}.${key} is not a tier field`);
  return bad;
}

/** Shape problems of the tier map of one profile. */
export function tierMapProblems(profile: string, tiers: Parsed): string[] {
  const bad = [];
  if (!isPlainObject(tiers) || !Object.keys(tiers).length) return [`tiers.${profile} must be a non-empty map`];
  for (const [tier, def] of Object.entries(tiers)) {
    if (!NAME.test(tier)) bad.push(`tiers.${profile}.${tier} is not a tier name`);
    bad.push(...tierDefinitionProblems(profile, tier, def));
  }
  return bad;
}

function tierFolderKindProblems(manifest: SlotManifest, profile: string, tier: string, kinds: string[], at: string): string[] {
  const known = new Set(manifest.slots.filter((slot) => slot.profiles.includes(profile) && slot.tier === tier).flatMap((slot) => [...(slot.kinds ?? []), ...(slot.layers ?? [])]));
  return kinds.filter((kind: Parsed) => !known.has(kind)).map((kind: Parsed) => `${at} names ${kind}, which is not a folder kind of the ${tier} tier`);
}

function tierSlotRestrictionProblems(manifest: SlotManifest, profile: string, tier: string, def: TierDef): string[] {
  const bad = [];
  const known = new Set(manifest.slots.filter(slot => slot.profiles.includes(profile) && slot.tier === tier).map(slot => slot.id));
  for (const [target, restriction] of Object.entries(def.mayImportSlots ?? {})) {
    const at = `tiers.${profile}.${tier}.mayImportSlots.${target}`;
    if (!def.mayImport.includes(target)) bad.push(`${at} restricts a tier that mayImport does not allow`);
    for (const id of restriction.from) if (!known.has(id)) bad.push(`${at}.from names ${id}, which is not a slot of the ${profile} ${tier} tier`);
  }
  return bad;
}

/** Kind and slot restrictions narrow allowed tier edges and name declared source and target roles. */
export function tierKindProblems(manifest: SlotManifest, profile: string): string[] {
  const bad = [];
  for (const [tier, def] of Object.entries(manifest.tiers[profile] as Record<string, TierDef>)) {
    bad.push(...tierSlotRestrictionProblems(manifest, profile, tier, def));
    for (const [target, kinds] of Object.entries(def.mayImportKinds ?? {})) {
      const at = `tiers.${profile}.${tier}.mayImportKinds.${target}`;
      if (!def.mayImport.includes(target)) bad.push(`${at} restricts a tier that mayImport does not allow`);
      bad.push(...tierFolderKindProblems(manifest, profile, tier, kinds.from, `${at}.from`), ...tierFolderKindProblems(manifest, profile, target, kinds.to, `${at}.to`));
    }
  }
  return bad;
}

/** The semantic rules of a runtime manifest beyond the slot rules both kinds share: tier names and the schema major. */
export function runtimeSemanticProblems(m: Parsed): string[] {
  const bad = tierKindProblems(m, RUNTIME_KIND);
  const tiers: Record<string, TierDef> = m.tiers.runtime;
  for (const [tier, def] of Object.entries(tiers)) {
    for (const target of def.mayImport) if (!(target in tiers)) bad.push(`tiers.runtime.${tier}.mayImport names ${target}, which is not a runtime tier`);
  }
  const major = Number(m.version.split('.')[0]);
  if (String(m.schema) !== `starci/runtime-slots@${major}`) bad.push(`schema ${m.schema} does not carry the major of version ${m.version}`);
  return bad;
}
