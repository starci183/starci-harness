// slot-classify.mjs - what slot of one scope (the app root or one side) owns a path: its status, owner unit, tier, folder kind and role.
// A scope is {manifest, repo, profile, edition, slots, byId, variants, appKind} built once by slots.mjs; every function here reads it.
import { globExpression } from '../lib/glob.mjs';
import { declaredSlotEnabled } from './declaration-slots.mjs';
import { bestMatch, fillVars, matchVariants, nearestSlot } from './slot-match.mjs';
import type { Bindings, Match, NearestSlot, Variant } from './slot-match.mjs';
import type { Slot, SlotManifest, SlotPresence, SlotTracking } from './manifest-shape.mjs';
import type { RepoView } from './slots.mjs';
import { cleanSlotPath } from './slot-path.mjs';

/** One scope (the app root or one side) as slots.mjs builds it: the manifest, the declaration view and the slots enabled for the profile and edition. */
export interface Scope {
  manifest: SlotManifest;
  repo: RepoView;
  profile: string;
  slots: Slot[];
  byId: Map<string, Slot>;
  variants: Variant[];
  appKind: Map<string, string>;
}

/** A path two slots own with equal specificity (a manifest gap). */
export interface AmbiguousPath {
  path: string;
  status: 'ambiguous';
  candidates: string[];
  side?: string;
  slot?: undefined;
  root?: undefined;
  bindings?: undefined;
  tracking?: undefined;
  nearest?: undefined;
}

/** A path no slot owns (code HFS_SLOT_UNDECLARED), with the nearest slot. */
export interface UndeclaredPath {
  path: string;
  status: 'no-slot';
  code: 'HFS_SLOT_UNDECLARED';
  nearest: NearestSlot | null;
  side?: string;
  slot?: undefined;
  root?: undefined;
  bindings?: undefined;
  tracking?: undefined;
}

/** A path a slot owns: the slot, its instance root and bound variables, and what the slot says about it. */
export interface PlacedPath {
  path: string;
  status: 'owned' | 'forbidden' | 'not-enabled';
  slot: string;
  root: string;
  bindings: Bindings;
  kind?: string;
  role?: string;
  presence: SlotPresence;
  tracking: SlotTracking;
  goesTo?: string | undefined;
  side?: string;
  nearest?: undefined;
}

/**
 * The answer of classifyPath. status: owned | forbidden (external slot) | not-enabled (opt-in slot the repository did not declare) |
 * ambiguous | no-slot. Through the app resolver a path below a side folder also carries `side`.
 */
export type ClassifiedPath = AmbiguousPath | UndeclaredPath | PlacedPath;

/** The owner unit of a path: the owner slot instance containing it. */
export interface OwnerUnit {
  slot: string;
  root: string;
  bindings: Bindings;
  side?: string;
}

/** Whether the repository of the scope holds the slot. */
export function slotEnabled(scope: Scope, slot: Slot): boolean {
  // A provider slot is gated by its provider in every edition: litePresence may lift it to required, but it still
  // exists for this repository only while a connection declares the provider.
  if (slot.provider !== undefined) return declaredSlotEnabled(slot, scope.repo);
  if (slot.presence !== 'opt-in') return true;
  return declaredSlotEnabled(slot, scope.repo);
}

/** The folder kind of a file in its slot, from a named layer or kind folder. */
function kindOf({ variant, slot, root }: Match, p: string): string | null {
  const names = [...(slot.layers ?? []), ...(slot.kinds ?? [])];
  if (!names.length) return null;
  const literal = variant.segments.find((segment) => names.includes(segment));
  if (literal) return literal;
  const below = root ? p.slice(root.length + 1) : p;
  return below.split('/').slice(0, -1).find((segment) => names.includes(segment)) ?? null;
}

/** The role of a file in its slot: the entry of `roles` whose file name (variables filled from the path, `*` a wildcard inside the name) matches the file's name. */
function roleOf(slot: Slot, bindings: Bindings, p: string): string | null {
  const name = p.split('/').pop() as string;
  for (const [role, file] of Object.entries(slot.roles ?? {})) if (globExpression(fillVars(file, bindings)).test(name)) return role;
  return null;
}

/**
 * status: owned | forbidden (external slot) | not-enabled (opt-in slot the repository did not declare) | ambiguous
 * (two slots of equal specificity; a manifest gap) | no-slot (code HFS_SLOT_UNDECLARED, with the nearest slot).
 */
export function classifyIn(scope: Scope, input: string): ClassifiedPath {
  const p = cleanSlotPath(input);
  const { hit, ambiguous } = bestMatch(matchVariants(scope, p));
  if (ambiguous.length) return { path: p, status: 'ambiguous', candidates: ambiguous };
  if (!hit) return { path: p, status: 'no-slot', code: 'HFS_SLOT_UNDECLARED', nearest: nearestSlot(scope.variants, p) };
  const { slot, root, bindings } = hit;
  const status = (slot.presence === 'forbidden' && 'forbidden') || (slotEnabled(scope, slot) ? 'owned' : 'not-enabled');
  const kind = kindOf(hit, p);
  const role = roleOf(slot, bindings, p);
  return { path: p, status, slot: slot.id, root, bindings, ...(kind ? { kind } : {}), ...(role ? { role } : {}), presence: slot.presence, tracking: slot.tracked, ...(status === 'forbidden' ? { goesTo: slot.goesTo } : {}) };
}

/** The owner unit of `p`: the most specific owner slot instance containing it (a slot's own root when it owns nothing). */
export function ownerIn(scope: Scope, input: string): OwnerUnit | null {
  const p = cleanSlotPath(input);
  const { hit } = bestMatch(matchVariants(scope, p, (s) => s.owner === true));
  return hit ? { slot: hit.slot.id, root: hit.root, bindings: hit.bindings } : null;
}

/** The tier of `p` in the direction matrix: its slot's tier, the owner's for an inheriting slot, none for an untiered one; null when no slot owns it. */
export function tierIn(scope: Scope, input: string): string | null {
  const c = classifyIn(scope, input);
  if (!c.slot) return null;
  const tier = (scope.byId.get(c.slot) as Slot).tier;
  if (tier !== 'inherit') return tier;
  const owner = ownerIn(scope, input);
  return owner ? (scope.byId.get(owner.slot) as Slot).tier : 'none';
}
