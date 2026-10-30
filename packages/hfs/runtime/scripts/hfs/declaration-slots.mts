// declaration-slots.mjs - how an app declaration (hfs.json) switches on the opt-in slots of a side: by name (`optionalSlots`), by app kind
// (a slot with `appKind`) and by declared pattern (a slot with `pattern: <name>` is enabled by `sides.<side>.patterns: [<name>]`, one
// mechanism for pattern slots). A cross-cutting pattern can instead be owned by the side's canonical proof scenario catalog.
// slots.mjs asks this file to judge a side's lists and to say whether a slot is enabled for a repository.
import type { Parsed, Slot } from './manifest-shape.mjs';
import type { RepoView } from './slots.mjs';
import { judgedInEdition } from './edition-slots.mjs';

/** The problems of a side's `optionalSlots` and `patterns` against the manifest. */
export function optionalSlotProblems(manifest: Parsed, side: Parsed, s: Parsed): string[] {
  const bad: string[] = [];
  for (const id of s.optionalSlots ?? []) {
    const slot = manifest.slots.find((candidate: Parsed) => candidate.id === id);
    if (!slot?.profiles.includes(side)) bad.push(`sides.${side}.optionalSlots names ${id}, which is not a ${side} slot`);
    else if (slot.presence !== 'opt-in') bad.push(`sides.${side}.optionalSlots names ${id}, which is ${slot.presence}, not opt-in`);
    else if (slot.appKind !== undefined) bad.push(`sides.${side}.optionalSlots names ${id}; an app of kind ${slot.appKind} enables it`);
  }
  for (const name of s.patterns ?? []) {
    const ownsSlot = manifest.slots.some((slot: Parsed) => slot.profiles.includes(side) && slot.pattern === name);
    const ownsProof = Object.hasOwn(manifest.ruleParams?.[side]?.patternScenarios ?? {}, name);
    if (!ownsSlot && !ownsProof) bad.push(`sides.${side}.patterns names ${name}, which neither a ${side} slot nor its proof scenario catalog declares`);
  }
  if (s.kinds !== undefined && side !== 'be') bad.push(`sides.${side}.kinds belongs to the be side`);
  for (const kind of s.kinds ?? []) {
    if (!(manifest.triggerKinds ?? []).includes(kind)) bad.push(`sides.${side}.kinds names ${kind}, which is not one of triggerKinds (${(manifest.triggerKinds ?? []).join(', ')})`);
  }
  return bad;
}

/** The problems of a side's `backing` list: every name is admitted by ruleParams.be.backing in this edition. */
export function backingProblems(manifest: Parsed, side: string, s: Parsed, edition = 'full'): string[] {
  const services = Object.entries(manifest.ruleParams?.be?.backing ?? {})
    .filter(([, entry]: [string, Parsed]) => judgedInEdition(entry, edition)).map(([name]) => name);
  return (s.backing ?? []).filter((name: Parsed) => !services.includes(name))
    .map((name: Parsed) => `sides.${side}.backing names ${name}, which is not admitted in edition ${edition} by ruleParams.be.backing (${services.join(', ')})`);
}

/** The problems of the shape of a side's `patterns` list (a unique list of pattern names). */
export function patternShapeProblems(s: Parsed, at: Parsed, namePattern: Parsed): string[] {
  const list = s.patterns;
  if (list === undefined) return [];
  return Array.isArray(list) && list.every((value: Parsed) => namePattern.test(String(value))) && new Set(list).size === list.length ? [] : [`${at}.patterns must be a unique list of pattern names`];
}

/** The problems of the shape of a side's `kinds` list (a unique list of trigger kind names). */
export function kindShapeProblems(s: Parsed, at: Parsed, namePattern: Parsed): string[] {
  const list = s.kinds;
  if (list === undefined) return [];
  return Array.isArray(list) && list.every((value: Parsed) => namePattern.test(String(value))) && new Set(list).size === list.length ? [] : [`${at}.kinds must be a unique list of trigger kind names`];
}

/** The problems of `ruleParams.be.kindPatterns` (trigger kind -> patterns) and `ruleParams.be.addKinds` (starci app add noun -> {topic, variable, patterns, trigger?, needs?, also?, defaults?, wire?}). */
export function kindParamProblems(be: Parsed, triggerKinds: Parsed): string[] {
  const kebab = /^[a-z][a-z0-9-]*$/;
  const names = (list: Parsed) => Array.isArray(list) && list.every((value: Parsed) => kebab.test(String(value))) && new Set(list).size === list.length;
  const bad: string[] = [];
  const patterns = be.kindPatterns;
  if (patterns === null || typeof patterns !== 'object' || Array.isArray(patterns) || !Object.entries(patterns).every(([kind, list]) => (triggerKinds ?? []).includes(kind) && names(list))) bad.push('ruleParams.be.kindPatterns must map a trigger kind to a unique list of pattern names');
  const nouns = be.addKinds;
  const nounOk = (spec: Parsed) => spec !== null && typeof spec === 'object' && kebab.test(String(spec.topic)) && kebab.test(String(spec.variable)) && names(spec.patterns) && (spec.trigger === undefined || kebab.test(String(spec.trigger))) && (spec.needs === undefined || names(spec.needs)) && (spec.also === undefined || names(spec.also)) && (spec.defaults === undefined || (typeof spec.defaults === 'object' && !Array.isArray(spec.defaults))) && (spec.wire === undefined || (spec.wire !== null && typeof spec.wire === 'object' && ['file', 'import', 'symbol'].every((key: Parsed) => typeof spec.wire[key] === 'string' && spec.wire[key] !== '')));
  if (nouns === null || typeof nouns !== 'object' || Array.isArray(nouns) || !Object.entries(nouns).every(([noun, spec]) => kebab.test(noun) && nounOk(spec))) bad.push('ruleParams.be.addKinds must map a noun to {topic, variable, patterns, trigger?, needs?, also?, defaults?}');
  return bad;
}

/** The problems of `ruleParams.be.patternScenarios`: a pattern name to a non-empty list of unique kebab-case scenario ids. */
export function scenarioProblem(scenarios: Parsed) {
  const kebab = /^[a-z][a-z0-9-]*$/;
  const ok = scenarios !== null && typeof scenarios === 'object' && !Array.isArray(scenarios) && Object.entries(scenarios).every(([name, list]) => kebab.test(name) && Array.isArray(list) && list.length > 0 && list.every((id: Parsed) => kebab.test(String(id))) && new Set(list).size === list.length);
  return ok ? [] : ['ruleParams.be.patternScenarios must map a pattern name to a non-empty list of unique kebab-case scenario ids'];
}

/** The problems of the `trigger` of a slot against the manifest's `triggerKinds`: a known kind, on a feature-tier slot only. */
export function triggerProblems(slot: Parsed, triggerKinds: Parsed): string[] {
  if (slot.trigger === undefined) return [];
  const bad: string[] = [];
  if (!(triggerKinds ?? []).includes(slot.trigger)) bad.push(`slot ${slot.id}: trigger ${slot.trigger} is not one of triggerKinds`);
  if (slot.tier !== 'feature') bad.push(`slot ${slot.id}: a trigger belongs to a feature-tier slot`);
  return bad;
}

/** Whether an opt-in slot is enabled for the repository: by its app kind, by a connection's provider, by name in optionalSlots, or by its declared pattern. */
export function declaredSlotEnabled(slot: Pick<Slot, 'id' | 'appKind' | 'provider' | 'pattern'>, repo: Pick<RepoView, 'apps' | 'optionalSlots' | 'providers' | 'connections' | 'patterns'>): boolean {
  if (slot.appKind !== undefined) return repo.apps.some((app: Parsed) => app.kind === slot.appKind);
  // A provider declared on any connection (be owns them all today) enables the provider slots of every profile: repo.providers
  // is the app-wide union the declaration resolver computed; a hand-built repo falls back to its own connections.
  if (slot.provider !== undefined) return (repo.providers ?? (repo.connections ?? []).map((connection: Parsed) => connection.provider)).includes(slot.provider);
  return repo.optionalSlots.includes(slot.id) || (slot.pattern !== undefined && (repo.patterns ?? []).includes(slot.pattern));
}
