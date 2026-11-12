// side-gate.mts - the app verbs that work on one side refuse a project that does not declare it (PROJECT-1), before they touch a folder:
// `SIDE_NOT_DECLARED` names the verb, the side and the declaration, instead of a crash on a missing be/ or fe/. A verb that judges or renders
// every side (check, sync) skips an undeclared one by the declaration itself (slots.mts declaredAppSides), so it needs no gate here.
import fs from 'node:fs';
import path from 'node:path';
import { declaredSidesOf, type ProjectSide } from './project-sides.mjs';

/** The refusal of a verb whose side the project does not declare. */
export class SideRefusal extends Error {
  readonly code = 'SIDE_NOT_DECLARED';
}

/** The sides each `starci app add` noun writes into: a back-end pattern or a front-end unit. */
const ADD_NOUN_SIDES: Readonly<Record<string, readonly ProjectSide[]>> = Object.freeze({
  api: ['be'], webhook: ['be'], realtime: ['be'], saga: ['be'], job: ['be'], reactor: ['be'], queue: ['be'], projection: ['be'], cli: ['be'],
  table: ['be'], connection: ['be'], service: ['be'], spec: ['be'], inbox: ['be'],
  block: ['fe'], frame: ['fe'], composite: ['fe'], branch: ['fe'], leaf: ['fe'], page: ['fe'], overlay: ['fe'], layout: ['fe'],
});

/** The sides `starci app add <noun>` needs: its noun's, plus fe for a table with `--fe`, and for an app the side of its kind (`next` is fe). */
export function addNounSides(noun: string, { fe = false, kind }: { fe?: boolean; kind?: string | undefined } = {}): readonly ProjectSide[] {
  if (noun === 'app') return kind === undefined ? [] : [kind === 'next' ? 'fe' : 'be'];
  return [...(ADD_NOUN_SIDES[noun] ?? []), ...(noun === 'table' && fe ? ['fe' as const] : [])];
}

/**
 * Refuses `what` when the app at `repoRoot` does not declare every side of `sides`. An hfs.json that is absent, not an app declaration or without `sides` passes:
 * the verb's own refusal names that.
 */
export function requireSides(repoRoot: string, sides: readonly ProjectSide[], what: string): void {
  if (!sides.length) return;
  let declaration: { kind?: unknown; sides?: unknown };
  try { declaration = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8')); } catch { return; }
  if (declaration.kind !== 'app' || declaration.sides === null || typeof declaration.sides !== 'object') return;
  const declared = declaredSidesOf(declaration.sides);
  const missing = sides.filter((side) => !declared.includes(side));
  if (missing.length) throw new SideRefusal(`${what} works on the ${missing.join(' and ')} side, which hfs.json does not declare (sides: ${declared.join(', ')}); a project declares its sides under sides (PROJECT-1)`);
}
