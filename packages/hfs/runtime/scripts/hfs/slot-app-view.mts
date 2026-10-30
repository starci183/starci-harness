// slot-app-view.mjs - the resolver of a whole app: a root path is answered by the scope of the app root, a path below a side folder
// (be/, fe/) by that side's scope with the side prefixed back onto every path and root it returns. Only the declared `reads` cross sides.
// slots.mjs builds the scopes (`root` and `sides`, each a resolver of one scope) and hands them to appResolver.
import { APP_SCOPE, isSide, PROFILES } from './slot-manifest-shape.mjs';
import type { Side } from './slot-manifest-shape.mjs';
import { cleanSlotPath } from './slot-path.mjs';
import type { Slot } from './manifest-shape.mjs';
import type { ClassifiedPath, OwnerUnit } from './slot-classify.mjs';
import type { ImportVerdict, RepoView, RequiredPaths, Resolver, ScopeResolver } from './slots.mjs';

/** The declaration of an app: its two sides are always resolved. */
export interface AppRepo extends RepoView {
  sides: Record<Side, RepoView>;
}

/** What the app resolver composes: the app declaration, the resolver of the root scope and the resolver of each side. */
interface AppView {
  repo: AppRepo;
  root: ScopeResolver;
  sides: Record<Side, ScopeResolver>;
}

/** { side, rest } when `p` lies below a side folder, else null. */
function splitSide(input: string): { side: Side; rest: string } | null {
  const p = cleanSlotPath(input);
  const slash = p.indexOf('/');
  const head = slash < 0 ? p : p.slice(0, slash);
  return isSide(head) && slash > 0 ? { side: head, rest: p.slice(slash + 1) } : null;
}

const under = (side: Side, rel: string): string => (rel ? `${side}/${rel}` : side);

function prefixed(side: Side, c: ClassifiedPath): ClassifiedPath {
  return {
    ...c,
    path: under(side, c.path),
    side,
    ...(c.root !== undefined ? { root: under(side, c.root) } : {}),
    ...(c.nearest ? { nearest: { ...c.nearest, matchedPrefix: under(side, c.nearest.matchedPrefix), matchedDepth: c.nearest.matchedDepth + 1 } } : {}),
  } as ClassifiedPath;
}

function classifyApp({ root, sides }: AppView, input: string): ClassifiedPath {
  const at = splitSide(input);
  return at ? prefixed(at.side, sides[at.side].classifyPath(at.rest)) : root.classifyPath(input);
}

function ownerApp({ root, sides }: AppView, input: string): OwnerUnit | null {
  const at = splitSide(input);
  if (!at) return root.ownerOf(input);
  const owner = sides[at.side].ownerOf(at.rest);
  return owner ? { ...owner, root: under(at.side, owner.root), side: at.side } : null;
}

/** Whether `toPath`, of the other side, lies below a path `fromSide` declares it reads. */
const readsPath = (repo: AppRepo, fromSide: Side, toPath: string): boolean => repo.sides[fromSide].reads.some((read) => `${cleanSlotPath(toPath)}/`.startsWith(read));

/** The verdict of an import from a side file to a path of the other side (or of the app root, `toSide` null): allowed only through a declared read. */
function sideCrossing(repo: AppRepo, fromSide: Side, toSide: Side | null, toPath: string): ImportVerdict {
  return readsPath(repo, fromSide, toPath)
    ? { allowed: true, reason: 'sideRead', fromSide, toSide }
    : { allowed: false, reason: 'crossSide', fromSide, toSide, reads: repo.sides[fromSide].reads };
}

function importAllowedApp({ repo, root, sides }: AppView, fromPath: string, toPath: string): ImportVerdict {
  const from = splitSide(fromPath);
  const to = splitSide(toPath);
  // A side file may read an app-root path (db/types/) only through a declared read, exactly as it reads the other side.
  if (from && from.side !== to?.side) return sideCrossing(repo, from.side, to?.side ?? null, toPath);
  if (from && to) return sides[from.side].importAllowed(from.rest, to.rest);
  return root.importAllowed(fromPath, toPath);
}

function requiredPathsApp({ root, sides }: AppView): RequiredPaths {
  const own = root.requiredPaths();
  const paths = [...own.paths];
  const minimums = [...own.minimums];
  for (const side of PROFILES) {
    const required = sides[side].requiredPaths();
    paths.push(...required.paths.map((entry) => ({ ...entry, path: under(side, entry.path), side })));
    minimums.push(...required.minimums.map((entry) => ({ ...entry, side })));
  }
  return { paths, minimums };
}

function slotEnabledApp({ root, sides }: AppView, slot: Slot): boolean {
  if (slot.profiles.includes(APP_SCOPE)) return root.slotEnabled(slot);
  return PROFILES.some((side) => slot.profiles.includes(side) && sides[side].slotEnabled(slot));
}

/** The resolver of the app `repo`: `root` answers its root paths and `sides[side]` the paths below that side's folder. */
export function appResolver(repo: AppRepo, root: ScopeResolver, sides: Record<Side, ScopeResolver>): Resolver {
  const view: AppView = { repo, root, sides };
  const allSlots = [...new Map([...root.slots(), ...PROFILES.flatMap((side) => sides[side].slots())].map((s) => [s.id, s])).values()];
  const byId = new Map(allSlots.map((s): [string, Slot] => [s.id, s]));
  const classifyPath = (input: string): ClassifiedPath => classifyApp(view, input);
  return Object.freeze({
    repo,
    sides: Object.freeze(sides),
    /** The side of a path (be, fe) or null for a root path. */
    sideOf: (input: string) => splitSide(input)?.side ?? null,
    slot: (id: string) => byId.get(id) ?? null,
    slots: () => allSlots,
    slotEnabled: (slot: Slot) => slotEnabledApp(view, slot),
    classifyPath,
    slotOf: (p: string) => { const c = classifyPath(p); return c.slot ? byId.get(c.slot) : null; },
    ownerOf: (input: string) => ownerApp(view, input),
    tierOf: (input: string) => { const at = splitSide(input); return at ? sides[at.side].tierOf(at.rest) : root.tierOf(input); },
    importAllowed: (fromPath: string, toPath: string) => importAllowedApp(view, fromPath, toPath),
    requiredFiles: (input: string) => { const at = splitSide(input); return at ? sides[at.side].requiredFiles(at.rest).map((p) => under(at.side, p)) : root.requiredFiles(input); },
    requiredPaths: () => requiredPathsApp(view),
    trackingOf: (p: string) => classifyPath(p).tracking ?? null,
    isTracked: (p: string) => classifyPath(p).tracking === 'tracked',
    // The root has no tier and no rule parameters of its own; each side has them (sides.<side>.ruleParams()).
    ruleParams: () => null,
    allowedImports: () => null,
  });
}
