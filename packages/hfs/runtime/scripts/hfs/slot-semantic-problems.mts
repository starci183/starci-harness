// slot-semantic-problems.mts - semantic checks for the HFS slot manifest.
import { triggerProblems } from './declaration-slots.mjs';
import { presenceOf } from './slot-presence.mjs';
import { manifestKind, RUNTIME_KIND, runtimeSemanticProblems, tierKindProblems } from './manifest-shape.mjs';
import { APP_SCOPE, isSide, PROFILES } from './slot-manifest-shape.mjs';
import type { Slot, SlotManifest } from './manifest-shape.mjs';

/** The pure helpers of slots.mts that the semantic checks use (slot-match.mts and lib/glob.mts), handed in by the loader. */
export interface SemanticHelpers {
  varsOf: (text: string) => string[];
  braceVariants: (value: string) => string[];
  compileVariant: (slot: Slot, pattern: string) => unknown;
}

interface Claimed {
  ids: Set<string>;
  patterns: Map<string, string>;
}

function checkAppRootSlot(slot: Slot, bad: string[]): void {
  for (const key of ['appKind', 'owner', 'layers', 'kinds', 'composedBy', 'requiredWhen', 'requiredInstances'] as const) {
    if (slot[key] !== undefined) bad.push(`slot ${slot.id}: an app-root slot has no ${key}`);
  }
  if (slot.tier !== 'none') bad.push(`slot ${slot.id}: an app-root slot has tier none`);
}

function checkSideSlot(slot: Slot, profile: string, manifest: SlotManifest, bad: string[]): void {
  const tiers = manifest.tiers[profile] as SlotManifest['tiers'][string];
  if (slot.tier !== 'none' && slot.tier !== 'inherit' && !(slot.tier in tiers)) bad.push(`slot ${slot.id}: tier ${slot.tier} is not a ${profile} tier`);
  if (slot.appKind !== undefined && !(manifest.appKinds[profile] as string[]).includes(slot.appKind)) bad.push(`slot ${slot.id}: app kind ${slot.appKind} is not a ${profile} kind`);
  const known = new Set(Object.values(manifest.appKinds).flat());
  for (const kind of slot.exceptAppKinds ?? []) if (!known.has(kind)) bad.push(`slot ${slot.id}: exceptAppKinds names ${kind}, which is not an app kind`);
  bad.push(...triggerProblems(slot, manifest.triggerKinds));
}

function claimSlotPatterns(slot: Slot, profile: string, claimed: Map<string, string>, bad: string[], braceVariants: SemanticHelpers['braceVariants']): void {
  if (slot.appKind !== undefined || slot.declaredBy !== undefined) return;
  for (const variant of braceVariants(slot.path)) {
    const key = `${profile}:${variant}`;
    if (claimed.has(key)) bad.push(`slots ${claimed.get(key)} and ${slot.id} claim the same pattern ${variant} on ${profile}`);
    else claimed.set(key, slot.id);
  }
}

function checkSlotProfiles(slot: Slot, manifest: SlotManifest, claimed: Map<string, string>, bad: string[], braceVariants: SemanticHelpers['braceVariants']): void {
  for (const profile of slot.profiles) {
    if (profile === APP_SCOPE) checkAppRootSlot(slot, bad);
    else checkSideSlot(slot, profile, manifest, bad);
    claimSlotPatterns(slot, profile, claimed, bad, braceVariants);
  }
}


function checkNamedPathBindings(slot: Slot, pathVars: Set<string>, varsOf: SemanticHelpers['varsOf'], bad: string[]): void {
  for (const name of Object.keys(slot.requiredInstances ?? {})) {
    if (!pathVars.has(name)) bad.push(`slot ${slot.id}: requiredInstances names <${name}>, which the path does not bind`);
  }
  for (const file of Object.values(slot.roles ?? {})) {
    for (const name of varsOf(file)) if (!pathVars.has(name)) bad.push(`slot ${slot.id}: roles names <${name}> in ${file}, which the path does not bind`);
  }
  for (const entry of slot.requires ?? []) {
    for (const name of varsOf(entry)) if (!pathVars.has(name)) bad.push(`slot ${slot.id}: requires ${entry} uses <${name}>, which the path does not bind`);
  }
}

function checkSlotPatternCompilation(slot: Slot, bad: string[], braceVariants: SemanticHelpers['braceVariants'], compileVariant: SemanticHelpers['compileVariant']): void {
  for (const variant of braceVariants(slot.path)) {
    try { compileVariant(slot, variant); } catch (error) { bad.push(`slot ${slot.id}: pattern ${variant} does not compile (${(error as Error).message})`); }
  }
}

function checkSlotComposition(slot: Slot, manifest: SlotManifest, bad: string[]): void {
  for (const kind of slot.composedBy ?? []) {
    if (!slot.profiles.every((profile) => (manifest.appKinds[profile] as string[]).includes(kind))) bad.push(`slot ${slot.id}: composedBy names ${kind}, which is not an app kind of every profile of the slot`);
  }
  if (slot.layers !== undefined && slot.tier !== 'none' && !slot.profiles.every((profile) => (manifest.tiers[profile] as SlotManifest['tiers'][string])[slot.tier]?.lowerLayerOnly)) bad.push(`slot ${slot.id}: layers need a lowerLayerOnly tier`);
}

function checkSidePresence(slot: Slot, bad: string[]): void {
  if (slot.sidePresence !== undefined && slot.profiles.includes(APP_SCOPE)) bad.push(`slot ${slot.id}: an app-root slot has one presence, not a per-side sidePresence`);
  for (const profile of slot.profiles) {
    if (presenceOf(slot, profile) === 'forbidden' && typeof slot.goesTo !== 'string') bad.push(`slot ${slot.id}: forbidden for ${profile}, so it says where the content goes (goesTo)`);
  }
}

function checkSlotSemantics(slot: Slot, manifest: SlotManifest, claimed: Claimed, bad: string[], helpers: SemanticHelpers): void {
  if (claimed.ids.has(slot.id)) bad.push(`slot id ${slot.id} appears twice`);
  claimed.ids.add(slot.id);
  const pathVars = new Set(helpers.varsOf(slot.path));
  checkSlotProfiles(slot, manifest, claimed.patterns, bad, helpers.braceVariants);
  if (slot.appKind !== undefined && !pathVars.has('app')) bad.push(`slot ${slot.id}: an app-kind slot binds <app> in its path`);
  if (slot.requiredWhen !== undefined && slot.presence !== 'required') bad.push(`slot ${slot.id}: requiredWhen belongs to a required slot`);
  checkSidePresence(slot, bad);
  checkNamedPathBindings(slot, pathVars, helpers.varsOf, bad);
  checkSlotPatternCompilation(slot, bad, helpers.braceVariants, helpers.compileVariant);
  checkSlotComposition(slot, manifest, bad);
}

/** The problem of one declared side read, or null when a slot of the side it names (or of the app root) owns the path. */
function sideReadProblem(manifest: SlotManifest, side: string, read: string, braceVariants: SemanticHelpers['braceVariants']): string | null {
  const [owner, ...rest] = read.split('/');
  if (owner === side) return `sides.${side}.reads names ${read}, which is its own side`;
  const ownedBySide = isSide(owner);
  const profile = ownedBySide ? owner : APP_SCOPE;
  const prefix = ownedBySide ? rest.join('/') : read;
  const owned = manifest.slots.some((slot) => slot.profiles.includes(profile) && slot.presence !== 'forbidden' && braceVariants(slot.path).some((variant) => variant.startsWith(prefix)));
  const ownerName = ownedBySide ? owner : 'app-root';
  return owned ? null : `sides.${side}.reads names ${read}, which no ${ownerName} slot owns`;
}

function checkSideReads(manifest: SlotManifest, bad: string[], braceVariants: SemanticHelpers['braceVariants']): void {
  for (const side of PROFILES) {
    for (const read of (manifest.sides[side] as { reads: string[] }).reads) {
      const problem = sideReadProblem(manifest, side, read, braceVariants);
      if (problem) bad.push(problem);
    }
  }
}

function checkProfileTierTargets(manifest: SlotManifest, profile: string, bad: string[]): void {
  bad.push(...tierKindProblems(manifest, profile));
  for (const [tier, def] of Object.entries(manifest.tiers[profile] as SlotManifest['tiers'][string])) {
    for (const target of def.mayImport) {
      if (!(target in (manifest.tiers[profile] as SlotManifest['tiers'][string]))) bad.push(`tiers.${profile}.${tier}.mayImport names ${target}, which is not a ${profile} tier`);
    }
  }
}

function checkProfileAppKinds(manifest: SlotManifest, profile: string, bad: string[]): void {
  for (const kind of manifest.appKinds[profile] as string[]) {
    const owners = manifest.slots.filter((slot) => slot.profiles.includes(profile) && slot.appKind === kind && slot.parent === undefined);
    if (owners.length !== 1) bad.push(`${profile} app kind ${kind} must have exactly one slot that names no parent (found ${owners.length})`);
  }
}

function checkProfileMaps(manifest: SlotManifest, bad: string[]): void {
  for (const profile of PROFILES) {
    checkProfileTierTargets(manifest, profile, bad);
    checkProfileAppKinds(manifest, profile, bad);
  }
}

/** The rules a JSON Schema cannot state: unique ids, tiers named and reachable, app kinds, variables, no duplicate pattern. */
export function manifestSemanticProblems(manifest: SlotManifest, helpers: SemanticHelpers): string[] {
  const bad: string[] = [];
  const claimed: Claimed = { ids: new Set(), patterns: new Map() };
  for (const slot of manifest.slots) checkSlotSemantics(slot, manifest, claimed, bad, helpers);
  if (manifestKind(manifest) === RUNTIME_KIND) return [...bad, ...runtimeSemanticProblems(manifest)];
  checkSideReads(manifest, bad, helpers.braceVariants);
  checkProfileMaps(manifest, bad);
  const major = Number(manifest.version.split('.')[0]);
  if (String(manifest.schema) !== `starci/hfs-slots@${major}`) bad.push(`schema ${manifest.schema} does not carry the major of version ${manifest.version}`);
  return bad;
}
