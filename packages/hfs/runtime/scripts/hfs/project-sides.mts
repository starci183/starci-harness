// project-sides.mts - the sides a project declares (contexts/project/README.md PROJECT-1): hfs.json `sides` holds any non-empty subset
// of `be` (the back end, be/), `fe` (the front end, fe/) and `packages` (the root workspace packages, packages/, declared `packages: {}`).
// Each side is the folder of its name; a side's checks run only when it is declared, and a rule that joins two sides only when both are.
// `sides.nivoos` (nivoos-side.mts) is a declaration over the packages folder, not a fourth folder: a project that declares nivoos packages has the packages side.
import { DESKTOP_SIDE } from './desktop-side.mjs';
import { NIVOOS_SIDE } from './nivoos-side.mjs';

/** A side a project may declare: be and fe carry apps; packages is the root npm workspace packages/*. */
export type ProjectSide = 'be' | 'fe' | 'packages';
/** Every side a project may declare, in their canonical order. */
export const PROJECT_SIDES: readonly ProjectSide[] = Object.freeze(['be', 'fe', 'packages']);
/** Whether `value` names a side a project may declare. */
export const isProjectSide = (value: unknown): value is ProjectSide => (PROJECT_SIDES as readonly unknown[]).includes(value);

/** The sides a parsed hfs.json `sides` object declares, in canonical order (unknown keys left out; shape problems are declaration-shape's). */
export const declaredSidesOf = (sides: unknown): ProjectSide[] => (sides !== null && typeof sides === 'object' && !Array.isArray(sides)
  ? PROJECT_SIDES.filter((side) => Object.hasOwn(sides, side) || (side === 'packages' && Object.hasOwn(sides, NIVOOS_SIDE)))
  : []);

/** Every key `sides` of hfs.json may hold: the folder sides, the nivoos packages declaration and the desktop app (desktop-side.mts, a declaration with its own folder desktop/). */
export const DECLARABLE_SIDE_KEYS: readonly string[] = Object.freeze([...PROJECT_SIDES, NIVOOS_SIDE, DESKTOP_SIDE]);

/**
 * Whether a resolved app view declares `side`. A view built without `declaredSides` (a side view, a hand-built fixture) is the
 * app of both app sides and no root packages.
 */
export const sideDeclared = (repo: object | null | undefined, side: ProjectSide): boolean => {
  const declared = (repo as { declaredSides?: unknown } | null | undefined)?.declaredSides;
  return Array.isArray(declared) ? declared.includes(side) : side !== 'packages';
};
