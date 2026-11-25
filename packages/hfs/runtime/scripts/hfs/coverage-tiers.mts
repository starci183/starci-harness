// coverage-tiers.mts - which measured module is held to which coverage tier (owner 2026-11-25, BE-TEST-13, R273).
//
// The NUMBERS are the canon's and live once, in knowledge/sonar-gate.yaml (`overall.coverage`: the per-file floor, the tiers, the
// default tier; `newCode.coverage`: the patch bar), read through coverageBar. WHICH module is in which tier is the app's: module
// names differ per app, so hfs.json declares them in `sides.be.coverageTiers`, a map from a tier to the modules it holds:
//
//   "coverageTiers": { "A": ["domain/billing", "platform/outbox"], "C": ["integrations/*", "platform/*"] }
//
// An entry is `<layer>/<module>` (a folder of be/src/modules/<layer>/, where `*` stands for any characters of the module name) or
// `packages/<name>` (a root workspace package). A module no entry names is in the default tier. When several entries name a module,
// an entry without `*` wins, then the entry with the most literal characters, then the stricter tier (A before B). Three readers use
// this module: the codecov.yml render (one component per tier, at the tier's bar), R273 (each tier's lines and branches over the lcov)
// and the hfs.json shape check (tierDeclarationProblems).
import { coverageBar, type CoverageBar, type TierBar } from '../gates/sonar-gate.mjs';
import { declaredGatesOff } from '../lib/stack-declaration.mjs';
import { byCodeUnit } from '../lib/list.mjs';

/** hfs.json `sides.be.coverageTiers`: each tier the app names, with the modules it holds. */
export type TierDeclaration = Readonly<Record<string, readonly string[]>>;

/** A module entry: `<layer>/<module>` (a `*` inside the module name only) or `packages/<name>`. */
export const TIER_ENTRY = /^(?:packages\/[a-z0-9][a-z0-9-]*|(?!packages\/)[a-z][a-z0-9-]*\/[a-z0-9*][a-z0-9*-]*)$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What is wrong with a `sides.be.coverageTiers` value against the canon's tiers; an absent value declares nothing (every module is in the default tier). */
export function tierDeclarationProblems(value: unknown, bar: CoverageBar = coverageBar()): string[] {
  if (value === undefined) return [];
  const at = 'sides.be.coverageTiers';
  if (!isPlainObject(value)) return [`${at} must map a tier (${Object.keys(bar.tiers).join(', ')}) to the modules it holds`];
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [tier, entries] of Object.entries(value)) {
    if (!Object.hasOwn(bar.tiers, tier)) problems.push(`${at}.${tier} is no tier of the canon (${Object.keys(bar.tiers).join(', ')}, knowledge/sonar-gate.yaml)`);
    if (!Array.isArray(entries) || entries.length === 0 || !entries.every((entry) => typeof entry === 'string' && TIER_ENTRY.test(entry))) {
      problems.push(`${at}.${tier} must be a non-empty list of modules, each <layer>/<module> (a * only in the module name) or packages/<name>`);
      continue;
    }
    for (const entry of entries as string[]) {
      const other = seen.get(entry);
      if (other !== undefined) problems.push(`${at} names ${entry} in ${other === tier ? `${tier} twice` : `both ${other} and ${tier}`}`);
      else seen.set(entry, tier);
    }
  }
  return problems;
}

/** The literal characters of an entry: the more of them, the more specific it is. */
const literalLength = (entry: string): number => entry.replaceAll('*', '').length;

/** Whether `entry` names module `key` (`*` stands for any characters inside the module name). */
function names(entry: string, key: string): boolean {
  if (!entry.includes('*')) return entry === key;
  const source = entry.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join('[^/]*');
  return new RegExp(`^${source}$`).test(key);
}

/** The tier of module `key` (`domain/billing`, `packages/ui-kit`), or the default tier when the declaration names it nowhere. */
export function tierOf(key: string | null, declaration: TierDeclaration | undefined, bar: CoverageBar = coverageBar()): string {
  if (key === null || declaration === undefined) return bar.defaultTier;
  const matches = Object.entries(declaration).flatMap(([tier, entries]) => entries.filter((entry) => names(entry, key)).map((entry) => ({ tier, entry })));
  if (matches.length === 0) return bar.defaultTier;
  matches.sort((left, right) => Number(left.entry.includes('*')) - Number(right.entry.includes('*')) || literalLength(right.entry) - literalLength(left.entry) || byCodeUnit(left.tier, right.tier));
  return (matches[0] as { tier: string }).tier;
}

/**
 * The module key of a file, app-relative or relative to the be side: `<layer>/<module>` below (be/)src/modules, `packages/<name>` below a root
 * package's src/, else null (a file straight in a layer folder belongs to no module: the default tier).
 */
export function moduleKeyOf(file: string): string | null {
  const be = /^(?:be\/)?src\/modules\/([^/]+)\/([^/]+)\//.exec(file);
  if (be) return `${be[1]}/${be[2]}`;
  const pkg = /^(packages\/[^/]+)\/src\//.exec(file);
  return pkg ? pkg[1] as string : null;
}

/** One tier of an app's measured scope: its bar and the modules (with the app-relative globs of their files) the tier holds. */
export interface TierScope { tier: string; bar: TierBar; modules: string[]; paths: string[] }

/**
 * The tiers of an app's measured scope, in tier order, each with the modules it holds: every module of a measured root (`src/modules/<layer>/*\/`
 * gives one module per folder the back-end files hold below it; a root without a placeholder is one module) and every measured root package.
 * A tier that holds no module is left out.
 *
 * @param roots the measured roots (be-relative, coverageScope)
 * @param files the back end's source files (be-relative)
 * @param packageFolders the measured root packages (app-relative, `packages/<name>`)
 */
export function tierScopes({ roots, files, packageFolders, businessFolders = [], declaration, bar = coverageBar() }: { roots: readonly string[]; files: readonly string[]; packageFolders: readonly string[]; businessFolders?: readonly string[]; declaration: TierDeclaration | undefined; bar?: CoverageBar }): TierScope[] {
  const modules = new Map<string, string>();
  for (const root of roots) {
    const layer = /^src\/modules\/([^/]+)\/\*\/$/.exec(root)?.[1];
    if (layer === undefined) {
      const fixed = /^src\/modules\/([^/]+\/[^/]+)\/$/.exec(root)?.[1];
      if (fixed !== undefined) modules.set(fixed, `be/${root}**`);
      continue;
    }
    for (const file of files) {
      const name = new RegExp(`^src/modules/${layer.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)}/([^/]+)/`).exec(file)?.[1];
      if (name !== undefined) modules.set(`${layer}/${name}`, `be/src/modules/${layer}/${name}/**`);
    }
  }
  for (const folder of packageFolders) modules.set(folder, `${folder}/src/**`);
  const byTier = new Map<string, string[]>();
  for (const key of [...modules.keys()].sort(byCodeUnit)) {
    const tier = tierOf(key, declaration, bar);
    byTier.set(tier, [...(byTier.get(tier) ?? []), key]);
  }
  const tiers = Object.keys(bar.tiers).sort(byCodeUnit).filter((tier) => byTier.has(tier)).map((tier): TierScope => {
    const held = byTier.get(tier) as string[];
    return { tier, bar: bar.tiers[tier] as TierBar, modules: held, paths: held.map((key) => modules.get(key) as string) };
  });
  // The business packages (hfs.json sides.nivoos) are no module of a tier: they are held to the business bar, together.
  const business = [...new Set(businessFolders)].sort(byCodeUnit);
  return business.length === 0 ? tiers : [...tiers, { tier: BUSINESS_TIER, bar: bar.business, modules: business, paths: business.map((folder) => `${folder}/src/**`) }];
}

/** The tier of the business packages (hfs.json sides.nivoos): the business bar of the canon gate, never a tier an app declares. */
export const BUSINESS_TIER = 'business';

/** The bar of a tier name: a declared tier's, or the business bar. */
export const barOf = (tier: string, bar: CoverageBar = coverageBar()): TierBar => (tier === BUSINESS_TIER ? bar.business : bar.tiers[tier] as TierBar);

/** The gates whose obligations the coverage bar is: the unit run (`test`) and its coverage proof (`coverage`). */
export const COVERAGE_OBLIGATION_GATES = Object.freeze(['test', 'coverage'] as const);

/**
 * The gate an app declares off (.starcistacks/application-stacks.yaml `gates`, PROJECT-LINT-4) that switches the coverage obligations off, as the line every
 * report shows for it (`test: off (declared: <reason>)`), or null when both gates run. The coverage tiers, the per-file floor and the business bar (R273) and
 * the spec of every cell and flow of a business package (HFS_NIVOOS_SPEC_MISSING, R436) are test and coverage obligations: judged only while those gates run,
 * never as an hfs finding of an app that declared them off.
 */
export function coverageObligationsOff(repoRoot: string | undefined): string | null {
  if (repoRoot === undefined) return null;
  const off = declaredGatesOff(repoRoot);
  const gate = COVERAGE_OBLIGATION_GATES.find((name) => off[name] !== undefined);
  return gate === undefined ? null : `${gate}: off (declared: ${off[gate] as string})`;
}

/** The Codecov component id of a tier (`tier-a`): no service app, `platform` or `package-<name>` component is ever named so. */
export const tierComponentId = (tier: string): string => `tier-${tier.toLowerCase()}`;
