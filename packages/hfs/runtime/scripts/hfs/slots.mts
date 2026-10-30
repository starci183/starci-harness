// hfs-slots.mjs - the HFS slot manifest and app declaration, loaded once and asked four questions:
//   which slot owns path P           slotOf(P) / classifyPath(P)   (an unknown path reports its nearest slot)
//   is import A -> B allowed         importAllowed(A, B)           (tier matrix, cross-owner entry, cross-app, layers)
//   which files are required         requiredFiles(P) / requiredPaths()
//   is this path tracked             isTracked(P) / trackingOf(P); the rule catalog (knowledge/hfs/rules.yaml, modules/schemas/hfs-rules.schema.yaml) loads through loadRuleCatalog / rules().
// Every check and lint rule of HFS reads knowledge/hfs/slots.yaml through this module; none keeps its own path
// list. The manifest shape is modules/schemas/hfs-slots.schema.yaml and hfs.json is modules/schemas/hfs-repo.schema.yaml;
// the installed runtime carries no npm dependency, so this file re-states those shapes instead of loading ajv.
//
// A product is ONE app repository: hfs.json at the app root has kind `app` and declares its two sides, `be` and `fe`, each in
// the folder of that name. The resolver of the app answers for the whole tree: a root path with the slots of profile `app`,
// a path below a side folder with that side's resolver (profile be or fe, the side folder as its root: the side view), so
// every check and lint rule runs unchanged with a side folder as its repository root. Nothing crosses sides except the
// paths the declaration lists in `sides.<side>.reads` (a subset of the manifest's `sides.<side>.reads`).
//
// One loader, two manifest kinds. `kind: app` (the default; knowledge/hfs/slots.yaml) is the product standard above.
// `kind: runtime` (knowledge/hfs/runtime-slots.yaml, schema starci/runtime-slots@<major>) is the standard of the StarCi
// runtime repository itself: one profile `runtime`, no sides and no app kinds, slot ids runtime.<name>, the tracked value
// `generated` (a copy written only by the slot's `generatedBy`). A runtime repository declares itself with
// hfs.json {"hfs": <major>, "kind": "runtime", "project": <name>}.
import fs from 'node:fs';
import path from 'node:path';
import { skillRoot } from '../../engine/runtime-root.mjs';
import { parseYamlCached } from '../lib/yaml-cached.mjs';
import { braceVariants } from '../lib/glob.mjs';
import { APP_KIND, RUNTIME_KIND, manifestKind } from './manifest-shape.mjs';
import { APP_SCOPE, isSide, manifestShapeProblems, PROFILES } from './slot-manifest-shape.mjs';
import type { Side } from './slot-manifest-shape.mjs';
import { manifestSemanticProblems } from './slot-semantic-problems.mjs';
import { classifyIn, ownerIn, slotEnabled, tierIn } from './slot-classify.mjs';
import { compileVariant, varsOf, variantsOf } from './slot-match.mjs';
import { importAllowedIn } from './slot-imports.mjs';
import { requiredFilesIn, requiredPathsIn } from './slot-required.mjs';
import { appResolver } from './slot-app-view.mjs';
import type { AppRepo } from './slot-app-view.mjs';
import { sideProblems } from './slot-side-problems.mjs';
import { declarationShapeProblems } from './declaration-shape.mjs';
import { declarationEdition, editionRuleParams, effectiveSlot, slotInEdition } from './edition-slots.mjs';
import { fail } from './slot-errors.mjs';
import { loadRuleCatalog } from './rule-catalog.mjs';
import type { RuleCatalog } from './rule-catalog.mjs';
import type { DbFunction, Parsed, RuleParams, Slot, SlotManifest, SlotTracking } from './manifest-shape.mjs';
import type { ClassifiedPath, OwnerUnit, Scope } from './slot-classify.mjs';

export type { Bindings } from './slot-match.mjs';
export type { ClassifiedPath, OwnerUnit, PlacedPath, AmbiguousPath, UndeclaredPath } from './slot-classify.mjs';
export type { Slot, SlotManifest, RuleParams } from './manifest-shape.mjs';

/** A thrown value read for its `message` or `code` (the caught value is unknown). */
type ErrorLike = { code?: unknown; message?: unknown } | null;

/** A bounded context an app side declares (hfs.json sides.be.connections). */
export interface ConnectionView {
  name: string;
  envPrefix: string;
  owner: string;
  isolation: string;
  provider?: string;
}

/** An app of a side: its folder name and kind. */
export interface AppRef {
  name: string;
  kind: string;
}

/**
 * The declaration (hfs.json) of an app, or of one side of it, resolved against the manifest: the frozen view a check runs under.
 * The app (profile app) carries its two sides under `sides`; a side's view (profile be or fe) carries `side`.
 */
export interface RepoView {
  hfs: number;
  kind: string;
  project: string;
  edition?: string | undefined;
  side: string | null;
  profile: string;
  apps: readonly AppRef[];
  optionalSlots: readonly string[];
  patterns?: readonly string[];
  kinds?: readonly string[];
  backing?: readonly string[];
  connections: readonly ConnectionView[];
  providers?: readonly string[];
  reads: readonly string[];
  dbFunctions?: readonly DbFunction[];
  grammar?: string;
  extraPackages?: readonly { name: string; reason: string }[];
  sides?: Record<Side, RepoView>;
  manifestVersion: string;
}

/** The verdict of importAllowed: `allowed`, the `reason` and the details that reason carries (tiers, owner, layer, kind restriction, ...). */
export interface ImportVerdict {
  allowed: boolean;
  reason: string;
  [detail: string]: unknown;
}

/** One path a required slot (or one of its `requires`) must hold. `via` is slot (a fixed path), instance (a requiredInstances or app-kind root) or requires. */
export interface RequiredPath {
  slot: string;
  path: string;
  via: string;
  side?: string;
}

/** The least number of instances a required slot must have. */
export interface RequiredMinimum {
  slot: string;
  min: number;
  appKind?: string;
  side?: string;
}

/** What the repository must contain without walking it. */
export interface RequiredPaths {
  paths: RequiredPath[];
  minimums: RequiredMinimum[];
}

/**
 * The four questions for one app, or for one side of it. The resolver of an app (profile app) answers `sideOf` and carries its
 * side resolvers under `sides`; it has no rule parameters or allowed imports of its own (`ruleParams()` is null).
 */
export interface Resolver {
  repo: RepoView;
  sides?: Record<Side, ScopeResolver>;
  sideOf?: (input: string) => string | null;
  slot: (id: string) => Slot | null;
  slots: () => Slot[];
  slotEnabled: (slot: Slot) => boolean;
  classifyPath: (input: string) => ClassifiedPath;
  slotOf: (p: string) => Slot | null | undefined;
  ownerOf: (input: string) => OwnerUnit | null;
  tierOf: (input: string) => string | null;
  importAllowed: (fromPath: string, toPath: string) => ImportVerdict;
  requiredFiles: (input: string) => string[];
  requiredPaths: () => RequiredPaths;
  trackingOf: (p: string) => SlotTracking | null;
  isTracked: (p: string) => boolean;
  ruleParams: () => RuleParams | null;
  allowedImports: (tier: string) => string[] | null;
}

/** The resolver of one scope (the app root or one side): the same questions, with the rule parameters of its profile. */
export interface ScopeResolver extends Resolver {
  ruleParams: () => RuleParams;
}

/** What openHfs reads: the manifest root, then either an app folder on disk (`repoRoot`) or a parsed hfs.json (`declaration`, with `side`). */
export interface OpenHfsOptions {
  root?: string | undefined;
  repoRoot?: string | undefined;
  declaration?: Parsed;
  side?: string | null | undefined;
  manifest?: SlotManifest | undefined;
}

/** The manifest of the runtime, the declaration it resolved and the resolver over both. */
export interface OpenedHfs extends Resolver {
  manifest: SlotManifest;
  rules: () => RuleCatalog;
}
export { litePresenceOf, slotInEdition } from './edition-slots.mjs';
export { HfsSlotsError } from './slot-errors.mjs';
export { loadRuleCatalog };
export { rules } from './rule-catalog.mjs';
export { APP_SCOPE };
const HFS_MANIFEST_FILE = 'knowledge/hfs/slots.yaml';
/** The manifest of kind runtime: the standard tree of the StarCi runtime repository (judged by scripts/hfs/runtime-check.mjs). */
export const RUNTIME_MANIFEST_FILE = 'knowledge/hfs/runtime-slots.yaml';
export const HFS_DECLARATION_FILE = 'hfs.json';
export const SIDES = Object.freeze([...PROFILES]);

/**
 * The rewriter of a side's finding messages: `(message) => message` with its paths made app-relative like the finding's own path.
 * Every check and rule of a side judges the side folder as its root, so the paths it names (`apps/web/src/...`, `src/modules/...`,
 * `tsconfig.json`) are side-relative. A path here is a token that starts at a word boundary with a top-level entry of the side folder
 * (`sideRoot`, read once) and goes on with `/`, or is that entry when its name holds a dot (a file). An import specifier (`@/x`,
 * `../x`) or a path already app-relative is left alone.
 */
export function appRelativeMessages(side: string, sideRoot: string): (message: string) => string {
  let entries: string[] = [];
  try { entries = fs.readdirSync(sideRoot).filter((name) => name !== 'node_modules' && !name.startsWith('.git')); } catch { /* no side folder: nothing to rewrite */ }
  if (!entries.length) return (message) => message;
  const escaped = entries.sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  const token = new RegExp(`(^|[\\s'"\`(\\[{,;=<>])((?:${escaped.join('|')})(?=/|[\\s'"\`)\\]},;:!?<>]|\\.(?:\\s|$)|$))`, 'g');
  return (message) => (typeof message === 'string' && message
    ? message.replace(token, (whole, before, entry, offset) => (message.startsWith('/', offset + whole.length) || entry.includes('.') ? `${before}${side}/${entry}` : whole))
    : message);
}

// ------------------------------------------------------------------------------------------- manifest

/**
 * The parsed and validated manifest. `text` (or `file`, or `root`) selects the source; the default is the runtime's own
 * knowledge/hfs/slots.yaml. A manifest that fails its shape or a semantic rule is refused whole (HFS_MANIFEST_INVALID).
 */
export function loadSlotManifest({ root = skillRoot, file = path.join(root, HFS_MANIFEST_FILE), text }: { root?: string | undefined; file?: string | undefined; text?: string | undefined } = {}): SlotManifest {
  let doc: Parsed;
  try { doc = parseYamlCached(text ?? fs.readFileSync(file, 'utf8')); } catch (error) { fail('HFS_MANIFEST_INVALID', `the slot manifest cannot be read (${String((error as ErrorLike)?.message ?? error).split('\n')[0]})`, { file }); }
  const problems = manifestShapeProblems(doc);
  if (!problems.length) problems.push(...manifestSemanticProblems(doc, { varsOf, braceVariants, compileVariant }));
  if (problems.length) fail('HFS_MANIFEST_INVALID', `the slot manifest breaks its schema: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? '; and ' + (problems.length - 5) + ' more' : ''}`, { file, problems });
  const [major, minor, patch] = doc.version.split('.').map(Number);
  return Object.freeze({ ...doc, major, minor, patch });
}

// ------------------------------------------------------------------------------------- declaration

const declarationInvalid: (problems: string[], file: string) => never = (problems, file) => fail('HFS_DECLARATION_INVALID', `hfs.json is refused: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? '; and ' + (problems.length - 5) + ' more' : ''}`, { file, problems });

function runtimeDeclaration(manifest: SlotManifest, declaration: Parsed, file: string, side: string | null): RepoView {
  if (side !== null) fail('HFS_DECLARATION_INVALID', 'a runtime repository has no sides', { file, side });
  return Object.freeze({
    hfs: declaration.hfs,
    kind: RUNTIME_KIND,
    project: declaration.project,
    side: null,
    profile: RUNTIME_KIND,
    apps: Object.freeze([]),
    optionalSlots: Object.freeze([]),
    connections: Object.freeze([]),
    reads: Object.freeze([]),
    manifestVersion: manifest.version,
  });
}

const connectionView = (c: Parsed): ConnectionView => Object.freeze({ name: c.name, envPrefix: c.envPrefix, owner: c.owner, isolation: c.isolation, ...(c.provider !== undefined ? { provider: c.provider } : {}) });

/** The declaration of one side of an app, frozen: the view a check of that side folder runs under. */
function sideDeclaration(manifest: SlotManifest, declaration: Parsed, name: string, edition: string, providers: readonly string[]): RepoView {
  const s = declaration.sides[name];
  return Object.freeze({
    hfs: declaration.hfs,
    kind: APP_KIND,
    project: declaration.project,
    edition,
    side: name,
    profile: name,
    apps: Object.freeze(s.apps.map((a: Parsed) => Object.freeze({ name: a.name, kind: a.kind }))),
    optionalSlots: Object.freeze([...(s.optionalSlots ?? [])]),
    patterns: Object.freeze([...(s.patterns ?? [])]), kinds: Object.freeze([...(s.kinds ?? [])]),
    backing: Object.freeze([...(s.backing ?? [])]),
    connections: Object.freeze((s.connections ?? []).map(connectionView)),
    providers,
    reads: Object.freeze([...(s.reads ?? [])]),
    dbFunctions: Object.freeze((s.dbFunctions ?? []).map((entry: Parsed) => Object.freeze({ ...entry }))),
    ...(s.grammar === undefined ? {} : { grammar: s.grammar }),
    ...(s.extraPackages === undefined ? {} : { extraPackages: Object.freeze(s.extraPackages.map((entry: Parsed) => Object.freeze({ ...entry }))) }),
    manifestVersion: manifest.version,
  });
}

/** R334: an app's bare database function name must be a pg built-in the canon lists bare (ruleParams.be.dbFunctions); any other is schema.name. */
function bareDbFunctionProblems(manifest: SlotManifest, be: Parsed): string[] {
  const builtins = new Set((manifest.ruleParams?.be?.dbFunctions ?? []).map((entry) => entry.name).filter((name) => !name.includes('.')));
  return (be?.dbFunctions ?? []).filter((entry: DbFunction) => !entry.name.includes('.') && !builtins.has(entry.name))
    .map((entry: DbFunction) => `sides.be.dbFunctions names ${entry.name} bare, but a bare name is only a pg built-in of the canon's list (ruleParams.be.dbFunctions); name a function of a migration schema-qualified (public.${entry.name})`);
}

/**
 * A declaration checked against the manifest: kind app, the pinned major the manifest's (HFS_MANIFEST_MAJOR_MISMATCH otherwise,
 * and there is no compatibility window), and per side: app kinds of that profile, optionalSlots naming only opt-in slots of the
 * side that no app kind implies, every required app kind declared, reads within the manifest's. Returns the app (profile app,
 * its two sides under `sides`), or with `side` that side's view: the declaration a check of the side folder runs under.
 */
export function resolveRepoDeclaration(manifest: SlotManifest, declaration: Parsed, { file = HFS_DECLARATION_FILE, side = null }: { file?: string; side?: string | null } = {}): RepoView {
  const problems = declarationShapeProblems(declaration, PROFILES);
  if (problems.length) declarationInvalid(problems, file);
  if (declaration.kind !== manifestKind(manifest)) declarationInvalid([`hfs.json is of kind ${declaration.kind}, but the manifest it is judged by is of kind ${manifestKind(manifest)}`], file);
  if (declaration.hfs !== manifest.major)
    fail('HFS_MANIFEST_MAJOR_MISMATCH', `hfs.json pins manifest major ${declaration.hfs} but the manifest is ${manifest.version}`, { pinned: declaration.hfs, manifest: manifest.version, manifestMajor: manifest.major, file });
  if (declaration.kind === RUNTIME_KIND) return runtimeDeclaration(manifest, declaration, file, side);
  const { edition, known, valid } = declarationEdition(manifest, declaration);
  if (!valid) fail('HFS_EDITION_INVALID', `hfs.json edition is ${JSON.stringify(declaration.edition)}; the editions this manifest knows are ${known.join(', ')} (absent means full)`, { file, edition: declaration.edition });
  const bad = [...PROFILES.flatMap((name) => sideProblems(manifest, name, declaration.sides[name], edition)), ...bareDbFunctionProblems(manifest, declaration.sides.be)];
  if (bad.length) declarationInvalid(bad, file);
  if (side !== null && !isSide(side)) fail('HFS_DECLARATION_INVALID', `${side} is not a side of an app (be, fe)`, { file, side });
  // A provider declared on any connection enables the provider slots of every profile (a fe side declares none): each view carries the union.
  const providers = Object.freeze([...new Set(PROFILES.flatMap((name) => (declaration.sides[name].connections ?? []).map((c: Parsed) => c.provider).filter((p: Parsed) => p !== undefined)))]);
  const sides = Object.fromEntries(PROFILES.map((name) => [name, sideDeclaration(manifest, declaration, name, edition, providers)])) as Record<Side, RepoView>;
  if (side !== null) return sides[side] as RepoView;
  return Object.freeze({
    hfs: declaration.hfs,
    kind: APP_KIND,
    project: declaration.project,
    edition,
    side: null,
    profile: APP_SCOPE,
    // The root declares no app or connection of its own (each side does); its opt-in slots are the browser journey and the managed
    // tsconfig.json that type-checks it, both switched on by `browser: true`.
    apps: Object.freeze([]),
    optionalSlots: Object.freeze(declaration.browser === true ? ['app.browser', 'app.browser-config'] : []),
    connections: Object.freeze([]),
    providers,
    reads: Object.freeze([]),
    sides: Object.freeze(sides),
    manifestVersion: manifest.version,
  });
}

/**
 * Where the declaration of `dir` lives: `dir` itself when it holds hfs.json (the app root), else its parent when `dir` is a side
 * folder (be/ or fe/) of an app (the side view). `{ file, appRoot, side }`; side is null at the app root.
 */
export function locateDeclaration(dir: string): { file: string; appRoot: string; side: string | null } {
  const own = path.join(dir, HFS_DECLARATION_FILE);
  if (fs.existsSync(own)) return { file: own, appRoot: dir, side: null };
  const parent = path.dirname(dir);
  const side = path.basename(dir);
  const up = path.join(parent, HFS_DECLARATION_FILE);
  if (isSide(side) && fs.existsSync(up)) return { file: up, appRoot: parent, side };
  return { file: own, appRoot: dir, side: null };
}

/**
 * hfs.json of the app at `repoRoot` (the app itself), or of the app whose side folder `repoRoot` is (that side's view), parsed and
 * resolved; a missing or unreadable file is a refusal, never "unavailable".
 */
export function readRepoDeclaration(manifest: SlotManifest, repoRoot: string): RepoView {
  const { file, side } = locateDeclaration(repoRoot);
  let declaration: Parsed;
  try { declaration = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { declarationInvalid([`hfs.json cannot be read (${String((error as ErrorLike)?.code ?? (error as ErrorLike)?.message ?? error).split('\n')[0]})`], file); }
  return resolveRepoDeclaration(manifest, declaration, { file, side });
}

// ------------------------------------------------------------------------------------------- resolver

/**
 * The four questions for one scope: the app root (profile app, root paths) or one side (profile be or fe, paths relative to the
 * side folder). createSlotResolver composes them; nothing else calls this.
 */
function createScopeResolver(manifest: SlotManifest, repo: RepoView): ScopeResolver {
  const profile = repo.profile;
  const edition = repo.edition ?? 'full';
  const slots = manifest.slots.filter((s) => s.profiles.includes(profile) && slotInEdition(manifest, s, edition)).map((s) => effectiveSlot(s, profile, edition));
  const scope: Scope = { manifest, repo, profile, slots, byId: new Map(slots.map((s): [string, Slot] => [s.id, s])), variants: slots.flatMap(variantsOf), appKind: new Map(repo.apps.map((a): [string, string] => [a.name, a.kind])) };
  const classifyPath = (input: string): ClassifiedPath => classifyIn(scope, input);
  /** tracked | ignored | external for the slot owning `p`, or null when no slot owns it. */
  const trackingOf = (p: string): SlotTracking | null => classifyPath(p).tracking ?? null;
  return Object.freeze({
    repo,
    slot: (id: string) => scope.byId.get(id) ?? null,
    slots: () => slots,
    slotEnabled: (slot: Slot) => slotEnabled(scope, slot),
    classifyPath,
    slotOf: (p: string) => { const c = classifyPath(p); return c.slot ? scope.byId.get(c.slot) : null; },
    ownerOf: (input: string) => ownerIn(scope, input),
    tierOf: (input: string) => tierIn(scope, input),
    importAllowed: (fromPath: string, toPath: string) => importAllowedIn(scope, fromPath, toPath),
    requiredFiles: (input: string) => requiredFilesIn(scope, input),
    requiredPaths: () => requiredPathsIn(scope),
    trackingOf,
    /** True only for a path a slot owns and requires to be committed. */
    isTracked: (p: string) => trackingOf(p) === 'tracked',
    // The app's own database functions (hfs.json sides.be.dbFunctions) join the canon's list (R334).
    ruleParams: () => withDeclaredDbFunctions(ruleParams(manifest, profile, edition), repo.dbFunctions),
    allowedImports: (tier: string) => manifest.tiers[profile]?.[tier]?.mayImport ?? null,
  });
}

/**
 * The four questions for one app, or for one side of it. `repo` comes from resolveRepoDeclaration / readRepoDeclaration.
 * Paths are relative to the root the declaration was resolved for (backslashes and a leading ./ are folded; a trailing / or a
 * directory path is fine): a side view (repo.side set) answers for the side folder as its root, exactly as a check of that side
 * runs; the app (profile app) answers a root path with the app-root slots and a path below be/ or fe/ with that side's view,
 * the side prefixed back onto every path and root it returns (and `side` added). Only the declared `reads` cross sides.
 */
export function createSlotResolver(manifest: SlotManifest, repo: RepoView): Resolver {
  if (repo.profile !== APP_SCOPE) return createScopeResolver(manifest, repo);
  // The root declares no connection of its own, yet a provider slot of the app profile is enabled by a
  // side's connection with that provider: the root scope reads the union of the sides' connections.
  // reason: the profile is app, so the declaration resolveRepoDeclaration built carries both sides
  const app = repo as AppRepo;
  const root = createScopeResolver(manifest, { ...repo, connections: SIDES.flatMap((side) => app.sides[side].connections) });
  const sides = Object.fromEntries(PROFILES.map((side) => [side, createScopeResolver(manifest, app.sides[side])])) as Record<Side, ScopeResolver>;
  return appResolver(app, root, sides);
}

/** The rule parameters with the app's declared database functions appended to `dbFunctions` (be only), frozen. */
const withDeclaredDbFunctions = (params: RuleParams, declared: readonly DbFunction[] = []): RuleParams => (params.dbFunctions === undefined && !declared.length ? params
  : Object.freeze({ ...params, dbFunctions: Object.freeze([...(params.dbFunctions ?? []), ...declared]) }) as RuleParams);

/** The rule parameters of one profile (be: infraOwners, suffixes, bannedSuffixes and the rest over the shared ruleParams.common fileLines and duplicateBlock; fe: common alone or with its overrides; runtime: ruleParams.runtime of a runtime manifest), as a frozen deep copy. Under `edition` lite the `lite` overrides of ruleParams.<profile> merge over the base (the `lite` key itself is never returned). */
export function ruleParams(manifest: SlotManifest, profile: string, edition = 'full'): RuleParams {
  const profiles: readonly string[] = manifestKind(manifest) === RUNTIME_KIND ? [RUNTIME_KIND] : PROFILES;
  if (!profiles.includes(profile)) fail('HFS_MANIFEST_INVALID', `ruleParams has no profile ${profile}`, { profile });
  return editionRuleParams({ ...manifest.ruleParams.common, ...manifest.ruleParams[profile] }, edition);
}

/**
 * The manifest of this runtime plus the resolver for the app or side folder at `repoRoot` (a side folder gets that side's view), or
 * for an already-parsed declaration (the app, or with `side` that side's view).
 */
export function openHfs({ root = skillRoot, repoRoot, declaration, side = null, manifest = loadSlotManifest({ root }) }: OpenHfsOptions = {}): OpenedHfs {
  const repo = declaration !== undefined ? resolveRepoDeclaration(manifest, declaration, { side }) : readRepoDeclaration(manifest, repoRoot as string);
  const resolver = createSlotResolver(manifest, repo);
  return { manifest, ...resolver, rules: () => loadRuleCatalog({ root, manifest }) };
}
