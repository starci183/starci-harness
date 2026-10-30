// slot-manifest-shape.mjs - the product slot manifest's schema-shaped validation.
import type { Parsed } from './manifest-shape.mjs';
import { isPlainObject } from '../../engine/plain-object.mjs';
import { byCodeUnit } from '../lib/list.mjs';
import { ruleParamsProblems } from './rule-params-shape.mjs';
import { APP_KIND, EDITIONS, MANIFEST_KINDS, NAME, PRESENCE, RUNTIME_KIND, SEMVER, TESTS, TRACKED, manifestKind, runtimeShapeProblems, slotProblems, tierMapProblems } from './manifest-shape.mjs';

/** A side of an app: the folder of that name holds it. */
export type Side = 'be' | 'fe';
export const PROFILES: readonly Side[] = ['be', 'fe'];
/** Whether `value` names a side of an app. */
export const isSide = (value: unknown): value is Side => (PROFILES as readonly unknown[]).includes(value);
export const APP_SCOPE = 'app';
export const SCOPES: string[] = [APP_SCOPE, ...PROFILES];

/** Shape problems of a parsed manifest, in the words of modules/schemas/hfs-slots.schema.yaml. */
function checkCoreManifestFields(m: Parsed, bad: string[]) {
  const allowed = new Set(['schema', 'kind', 'version', 'versioning', 'presenceValues', 'trackedValues', 'testValues', 'editions', 'sides', 'appKinds', 'triggerKinds', 'tiers', 'ruleParams', 'crossOwner', 'crossApp', 'slots', 'consumers', 'naming']);
  for (const key of Object.keys(m)) if (!allowed.has(key)) bad.push(`unknown top-level key ${key}`);
  if (!/^starci\/hfs-slots@\d+$/.test(String(m.schema))) bad.push('schema must be starci/hfs-slots@<major>');
  if (!SEMVER.test(String(m.version))) bad.push('version must be MAJOR.MINOR.PATCH');
  if (!isPlainObject(m.versioning) || !['patch', 'minor', 'major', 'pins'].every((k: Parsed) => typeof m.versioning[k] === 'string')) bad.push('versioning needs patch, minor, major and pins text');
  if (JSON.stringify(m.presenceValues) !== JSON.stringify(PRESENCE)) bad.push(`presenceValues must be ${PRESENCE.join(', ')}`);
  if (JSON.stringify(m.trackedValues) !== JSON.stringify(TRACKED)) bad.push(`trackedValues must be ${TRACKED.join(', ')}`);
  if (JSON.stringify(m.testValues) !== JSON.stringify(TESTS)) bad.push(`testValues must be ${TESTS.join(', ')}`);
  if (JSON.stringify(m.editions) !== JSON.stringify(EDITIONS)) bad.push(`editions must be ${EDITIONS.join(', ')}`);
}

function checkSideShapes(m: Parsed, bad: string[]) {
  if (!isPlainObject(m.sides) || Object.keys(m.sides).sort(byCodeUnit).join() !== PROFILES.join()) bad.push('sides must be a map with exactly be and fe');
  else for (const side of PROFILES) {
    const def = m.sides[side];
    if (!isPlainObject(def) || Object.keys(def).join() !== 'reads' || !Array.isArray(def.reads) || !def.reads.every((r: Parsed) => typeof r === 'string' && /^[a-z][a-z0-9-]*\/([^/]+\/)+$/.test(r)) || new Set(def.reads).size !== def.reads.length) bad.push(`sides.${side} must be {reads: [unique <owner>/<dir>/ paths]}`);
  }
}

function checkTriggerKinds(m: Parsed, bad: string[]) {
  if (m.triggerKinds !== undefined && (!Array.isArray(m.triggerKinds) || !m.triggerKinds.length || !m.triggerKinds.every((k: Parsed) => NAME.test(String(k))) || new Set(m.triggerKinds).size !== m.triggerKinds.length)) bad.push('triggerKinds must be a non-empty list of unique names');
}

function checkProfileMaps(m: Parsed, bad: string[]) {
  for (const key of ['appKinds', 'tiers']) {
    if (!isPlainObject(m[key])) { bad.push(`${key} must be a map with be and fe`); continue; }
    for (const extra of Object.keys(m[key])) if (!isSide(extra)) bad.push(`${key}.${extra} is not a profile`);
    for (const profile of PROFILES) if (!(profile in m[key])) bad.push(`${key}.${profile} is missing`);
  }
}

function checkAppKindAndTierShapes(m: Parsed, bad: string[]) {
  for (const profile of PROFILES) {
    const kinds = m.appKinds?.[profile];
    if (kinds !== undefined && (!Array.isArray(kinds) || !kinds.length || !kinds.every((k: Parsed) => NAME.test(String(k))) || new Set(kinds).size !== kinds.length)) bad.push(`appKinds.${profile} must be a non-empty list of unique names`);
    const tiers = m.tiers?.[profile];
    if (tiers === undefined) continue;
    bad.push(...tierMapProblems(profile, tiers));
  }
}

function checkSlotShapes(m: Parsed, bad: string[]) {
  if (!Array.isArray(m.slots) || !m.slots.length) { bad.push('slots must be a non-empty list'); return false; }
  const logicRoles = Array.isArray(m.ruleParams?.be?.logicRoles) ? m.ruleParams.be.logicRoles : [];
  m.slots.forEach((slot: Parsed, index: number) => bad.push(...slotProblems(slot, index, APP_KIND, { appScope: APP_SCOPE, scopes: SCOPES, logicRoles })));
  return true;
}

export function manifestShapeProblems(m: Parsed): string[] {
  const bad: string[] = [];
  if (!isPlainObject(m)) return ['the manifest is not a map'];
  if (!MANIFEST_KINDS.includes(manifestKind(m))) return [`kind must be one of ${MANIFEST_KINDS.join(', ')}`];
  if (manifestKind(m) === RUNTIME_KIND) return runtimeShapeProblems(m);
  checkCoreManifestFields(m, bad);
  checkSideShapes(m, bad);
  checkTriggerKinds(m, bad);
  checkProfileMaps(m, bad);
  checkAppKindAndTierShapes(m, bad);
  bad.push(...ruleParamsProblems(m));
  if (!checkSlotShapes(m, bad)) return bad;
  return bad;
}
