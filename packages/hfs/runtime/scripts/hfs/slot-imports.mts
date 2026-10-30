// slot-imports.mjs - whether one file of a scope (the app root or one side) may import another: the tier direction matrix, the
// owner units, the layer order and the public entry of an owner. Cycles are a graph property of the architecture check, not of one edge.
import { RUNTIME_KIND } from './manifest-shape.mjs';
import { classifyIn, ownerIn, tierIn } from './slot-classify.mjs';
import type { ClassifiedPath, OwnerUnit, PlacedPath, Scope } from './slot-classify.mjs';
import type { ImportVerdict } from './slots.mjs';
import type { Slot, TierDef } from './manifest-shape.mjs';
import { braceVariants, globExpression } from '../lib/glob.mjs';

const isEntryFile = (name: string): boolean => name === 'index.ts' || name === 'index.tsx';

function declaredEntry(slot: Slot, relative: string): boolean {
  return (slot.entries ?? []).some((entry: string) => braceVariants(entry).some((pattern: string) => globExpression(pattern).test(relative)));
}

function unownedPathProblem(from: ClassifiedPath, to: ClassifiedPath): ImportVerdict | null {
  for (const side of [from, to]) {
    if (side.status === 'no-slot') return { allowed: false, reason: 'unowned', code: side.code, path: side.path, nearest: side.nearest };
  }
  return null;
}

function unavailableSlotProblem(from: ClassifiedPath, to: ClassifiedPath): ImportVerdict | null {
  for (const side of [from, to]) {
    if (side.status !== 'owned') return { allowed: false, reason: `slot${(side.status[0] as string).toUpperCase()}${side.status.slice(1).replace(/-(.)/g, (_: string, c: string) => c.toUpperCase())}`, path: side.path, slot: side.slot };
  }
  return null;
}

function sameOwnerUnit(side: PlacedPath, owner: OwnerUnit | null): string {
  return owner ? `${owner.slot}:${owner.root}` : `${side.slot}:${side.root}`;
}

const layerIndex = (slot: Slot, root: string): number => (slot.layers ? slot.layers.findIndex((layer: string) => root.split('/').includes(layer)) : -1);

function lowerLayerProblem({ manifest, profile, byId }: Scope, from: PlacedPath, to: PlacedPath, fromTier: string, toTier: string, fromOwner: OwnerUnit | null, toOwner: OwnerUnit | null): ImportVerdict | null {
  if (((manifest.tiers[profile] as Record<string, TierDef>)[fromTier] as TierDef).lowerLayerOnly && fromTier === toTier) {
    const fromSlot = byId.get((fromOwner ?? from).slot) as Slot;
    const a = layerIndex(fromSlot, fromOwner?.root ?? from.root);
    const b = layerIndex(byId.get((toOwner ?? to).slot) as Slot, toOwner?.root ?? to.root);
    if (a >= 0 && b >= 0 && b <= a) return { allowed: false, reason: 'layerOrder', fromLayer: (fromSlot.layers as string[])[a], toLayer: (fromSlot.layers as string[])[b] };
  }
  return null;
}

function privateEntryProblem({ repo, byId }: Scope, to: PlacedPath, toOwner: OwnerUnit | null): ImportVerdict | null {
  if (toOwner && repo.kind !== RUNTIME_KIND) {
    const relative = to.path === toOwner.root ? '' : to.path.slice(toOwner.root.length + 1);
    const ownerSlot = byId.get(toOwner.slot) as Slot;
    const entry = isEntryFile(relative) || declaredEntry(byId.get(to.slot) as Slot, to.path.slice(to.root.length + 1)) || (ownerSlot.tier === 'package' && relative === 'src/index.ts') || (ownerSlot.tier === 'app' && relative === 'app.module.ts');
    if (!entry) return { allowed: false, reason: 'notPublicEntry', owner: toOwner.root, path: to.path };
  }
  return null;
}

function tierImportProblem(scope: Scope, from: PlacedPath, to: PlacedPath, fromTier: string, toTier: string): ImportVerdict | null {
  const { mayImport, mayImportKinds, mayImportSlots }: Partial<TierDef> = (scope.manifest.tiers[scope.profile] as Record<string, TierDef>)[fromTier] ?? {};
  if (!mayImport?.includes(toTier)) return { allowed: false, reason: 'tierDirection', fromTier, toTier, mayImport: mayImport ?? [] };
  const kindRestriction = mayImportKinds?.[toTier];
  if (kindRestriction && (!kindRestriction.from.includes(from.kind as string) || !kindRestriction.to.includes(to.kind as string))) return { allowed: false, reason: 'tierDirection', fromTier, toTier, mayImport, kindRestriction, fromKind: from.kind ?? null, toKind: to.kind ?? null };
  const slotRestriction = mayImportSlots?.[toTier];
  if (slotRestriction && !slotRestriction.from.includes(from.slot)) return { allowed: false, reason: 'tierDirection', fromTier, toTier, mayImport, slotRestriction, fromSlot: from.slot };
  return null;
}

/**
 * Whether `fromPath` may import `toPath`: {allowed, reason, ...}. Reasons: sameOwner, untiered, crossApp,
 * tierDirection, layerOrder, notPublicEntry, allowed, slotForbidden, slotNotEnabled, slotAmbiguous, and unowned (HFS_SLOT_UNDECLARED for the path no slot owns).
 * Cycles are a graph property and belong to the architecture check, not to one edge.
 */
export function importAllowedIn(scope: Scope, fromPath: string, toPath: string): ImportVerdict {
  const fromClassified = classifyIn(scope, fromPath);
  const toClassified = classifyIn(scope, toPath);
  const unowned = unownedPathProblem(fromClassified, toClassified);
  if (unowned) return unowned;
  const unavailable = unavailableSlotProblem(fromClassified, toClassified);
  if (unavailable) return unavailable;
  // reason: unavailableSlotProblem answers for every status but owned, so both paths are placed from here on
  const from = fromClassified as PlacedPath;
  const to = toClassified as PlacedPath;
  const fromTier = tierIn(scope, from.path) as string;
  const toTier = tierIn(scope, to.path) as string;
  if (fromTier === 'none' || toTier === 'none') return { allowed: true, reason: 'untiered' };
  if (from.bindings.app !== undefined && to.bindings.app !== undefined && from.bindings.app !== to.bindings.app)
    return { allowed: false, reason: 'crossApp', from: from.bindings.app, to: to.bindings.app };
  const fromOwner = ownerIn(scope, from.path);
  const toOwner = ownerIn(scope, to.path);
  if (sameOwnerUnit(from, fromOwner) === sameOwnerUnit(to, toOwner)) return { allowed: true, reason: 'sameOwner' };
  const tierProblem = tierImportProblem(scope, from, to, fromTier, toTier);
  if (tierProblem) return tierProblem;
  const layerProblem = lowerLayerProblem(scope, from, to, fromTier, toTier, fromOwner, toOwner);
  if (layerProblem) return layerProblem;
  // A runtime owner is imported file by file (crossOwner of knowledge/hfs/runtime-slots.yaml): no public entry.
  const privateEntry = privateEntryProblem(scope, to, toOwner);
  if (privateEntry) return privateEntry;
  return { allowed: true, reason: 'allowed', fromTier, toTier };
}
