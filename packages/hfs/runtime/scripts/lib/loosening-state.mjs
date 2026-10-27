// loosening-state.mjs - the state-based loosening check: does the tree, as it stands, hold a gate weaker than the canon says? (owner decision
// 2026-10-24, owner ruling loosening-state-check.) The history of the tree is never read: a deleted file, a re-pointed row or reworded text
// cannot be a loosening, and a loosening that stands cannot be hidden by when it was written. The check is red on
//   bypass          an inline disable, a type-check escape, a Sonar or coverage ignore, a skipped or focused test, a failure swallowed in a script,
//                   a hook or a workflow, a warning budget, a pass-with-no-tests flag, a hook skipped (scripts/lib/bypass-markers.mjs);
//   list-extra      an entry of an ignore or exclude list (codecov, sonar, jest, eslint, stylelint, tsconfig, a *ignore file) that the canon does not
//                   derive and the design-truths manifest does not allow FOR THAT FILE;
//   threshold       a coverage target below 100, a threshold above 0, a gate limit looser than the manifest's;
//   setting         a switch that relaxes a gate (`require_ci_to_pass: false`, `informational: true`, `passWithNoTests`, `requireCi: false`) that the
//                   manifest does not allow;
//   rule-off        an ESLint or stylelint rule turned off or down in a config;
//   strictness      a tsconfig strictness option turned off, or skipLibCheck (and the like) turned on outside the file the manifest allows;
//   budget          a numeric budget of the slot manifests raised, lowered or gone against the manifest's pins; budget-override: an app or example
//                   config (hfs.json, an ESLint config) that states a budget itself; scope-override: a jest config that narrows what runs;
//   exception-file  an allowlist, approval, waiver, suppression or baseline file that the manifest does not list, or one with more entries than it allows;
//   pin             a file the owner pinned (the manifest, the fixtures of this checker, the vendored YAML) whose digest differs from the pin;
//   fixture-misuse  code other than a package spec that imports the fixtures of this checker.
// Every legitimate exception lives in knowledge/hfs/design-truths.yaml, each with the cite of its owner ruling. The manifest itself is pinned by the
// digest the latest owner ruling records (pins): a lane that edits it turns the check red until the owner records a ruling. The library is pure: the
// caller hands the tracked files, a reader, the canon's derivations and the pins.
import { bypassFileKind, bypassesIn } from './bypass-markers.mjs';
import { LIST, configKindOf, configRecords, coreOf, exceptionEntries, isAnyDepth, isExceptionFile, maybeTsconfig } from './loosening-config.mjs';
import { braceVariants, globExpression } from './glob.mjs';
import { byCodeUnit, list as asArray } from './list.mjs';
import { budgetRecords } from './loosening-budgets.mjs';
import { manifestDigest as truthsDigest } from './grammar-vendor-parity.mjs';

export { truthsDigest };

const TRUTHS_SCHEMA = 'starci/design-truths@1';
const MANIFEST = 'knowledge/hfs/design-truths.yaml';

const LISTS = new Set(Object.values(LIST));
const RELAXING = Object.freeze({ require_ci_to_pass: 'false', informational: 'true', passWithNoTests: 'true', requireCi: 'false', if_ci_failed: 'success', status: 'off', 'sonar.qualitygate.wait': 'false', 'yaml-alias': 'true' });

const hasRuling = (cite) => cite !== null && typeof cite === 'object' && typeof cite.ruling === 'string' && cite.ruling.length > 0;
/** The file globs an allowance names: one string or a list of them. */
function globsOf(value) {
  const globs = [];
  for (const glob of [value].flat()) if (typeof glob === 'string') globs.push(glob);
  return globs;
}
const matchesFile = (globs, file) => globs.some((glob) => braceVariants(glob).some((variant) => globExpression(variant).test(file)));

function readListAllow(truth, allow, out) {
  if (!LISTS.has(allow.list)) out.problems.push(`truth ${truth.id}: unknown list ${allow.list}`);
  if (allow.derivedBy !== undefined) out.derivations.add(allow.derivedBy);
  const entries = asArray(allow.entries);
  if (entries.length > 0 && globsOf(allow.file).length === 0) out.problems.push(`truth ${truth.id}: an allowance of list entries names the file it holds for`);
  if (entries.length > 0) out.literal.push({ list: allow.list, files: globsOf(allow.file), entries });
}

function readAllow(truth, allow, out) {
  if (allow.list !== undefined) readListAllow(truth, allow, out);
  else if (allow.setting !== undefined) out.settings.push({ key: allow.setting, value: String(allow.value) });
  else if (allow.compilerOption !== undefined) out.options.push({ key: allow.compilerOption, value: String(allow.value), files: asArray(allow.files) });
  else if (allow.exceptionFile !== undefined) out.exceptionFiles.set(allow.exceptionFile, Number(allow.maxEntries ?? 0));
  else out.problems.push(`truth ${truth.id}: an allow names no list, setting, compilerOption or exceptionFile`);
}

/**
 * The manifest `doc` as the sets the check reads, plus `problems`: the shapes a malformed manifest breaks (a truth, a group, a budget pin or the gate
 * limits without an id, an owner-ruling cite, a sentence or an allowance is a problem, so an exception can never be anonymous or lane-authored).
 */
export function readTruths(doc) {
  const out = {
    problems: [], ids: [], fixtureFiles: asArray(doc?.fixtureFiles), vendored: new Set(asArray(doc?.vendored).map((entry) => entry.path)),
    groups: [], literal: [], derivations: new Set(), settings: [], options: [], exceptionFiles: new Map(), limits: doc?.gateLimits ?? null,
    budgets: asArray(doc?.budgets),
  };
  if (doc?.schema !== TRUTHS_SCHEMA) out.problems.push(`schema must be ${TRUTHS_SCHEMA}`);
  if (out.limits && !hasRuling(out.limits.cite)) out.problems.push('gateLimits: an owner-ruling cite is required');
  for (const group of asArray(doc?.outsideTheGates)) {
    if (!group.id || !hasRuling(group.cite)) out.problems.push(`outsideTheGates ${group.id ?? '?'}: id and an owner-ruling cite are required`);
    out.groups.push({ cores: new Set(asArray(group.entries).map(coreOf)), anyDepth: group.anyDepth === true });
  }
  for (const pin of out.budgets) if (!pin.file || !hasRuling(pin.cite)) out.problems.push(`budgets ${pin.file ?? '?'}: file and an owner-ruling cite are required`);
  for (const truth of asArray(doc?.truths)) {
    if (!truth.id || !hasRuling(truth.cite) || !truth.says || asArray(truth.allows).length === 0) out.problems.push(`truth ${truth.id ?? '?'}: id, an owner-ruling cite, says and allows are required`);
    out.ids.push(truth.id);
    for (const allow of asArray(truth.allows)) readAllow(truth, allow, out);
  }
  return out;
}

/** Whether the tree check reads `file`: every tracked file, but the fixtures of this checker (pinned by digest) and the vendored dependency copy (pinned too). */
export const inScope = (file, truths) => !truths.vendored.has(file) && !truths.fixtureFiles.includes(file);

/** Whether any reading of the check applies to `file`: only those files are read at all. */
const extensionless = (file) => !file.slice(file.lastIndexOf('/') + 1).includes('.');
const isJudged = (file, truths) => Boolean(bypassFileKind(file) || configKindOf(file) || maybeTsconfig(file) || extensionless(file) || isExceptionFile(file) || truths.limits?.file === file
  || truths.budgets.some((pin) => pin.file === file));

const finding = (kind, file, line, detail) => ({ id: `${kind}:${file}:${detail}`, kind, file, line, detail });

/** Whether the manifest lists `item` of `list` for `file`: a jest pattern by its exact text, any other entry by its path core. */
function listedFor(truths, file, list, item) {
  return truths.literal.some((allow) => allow.list === list && matchesFile(allow.files, file)
    && allow.entries.some((entry) => (list === LIST.jest ? entry === item : coreOf(entry) === coreOf(item) && isAnyDepth(entry) === isAnyDepth(item))));
}

/** Whether `item` names only what no gate reads (build output, generated records, sealed custody), rooted unless its group is the same at any depth. */
const outsideTheGates = (truths, item, list) => list !== LIST.jest && list !== LIST.issues && truths.groups.some((group) => group.cores.has(coreOf(item)) && (group.anyDepth || !isAnyDepth(item)));

function listFindings(file, records, truths, canon) {
  const derived = new Map();
  const derivedFor = (list) => {
    if (!derived.has(list)) {
      const from = canon.derive?.(file, list) ?? null;
      derived.set(list, from && truths.derivations.has(from.by) ? new Set(from.items.map((item) => (list === LIST.jest ? item : coreOf(item)))) : new Set());
    }
    return derived.get(list);
  };
  const allowed = (entry) => derivedFor(entry.list).has(entry.list === LIST.jest ? entry.item : coreOf(entry.item)) || outsideTheGates(truths, entry.item, entry.list) || listedFor(truths, file, entry.list, entry.item);
  return records.filter((entry) => !allowed(entry)).map((entry) => finding('list-extra', file, entry.line, `${entry.key}: ${entry.item}`));
}

function numberFindings(file, numbers) {
  return numbers.flatMap((entry) => {
    const loose = entry.key === 'threshold' ? entry.value > 0 : entry.value < 100;
    return loose ? [finding('threshold', file, entry.line, `${entry.key} ${entry.value}`)] : [];
  });
}

const normalised = (value) => ({ yes: 'true', on: 'true', no: 'false', off: 'off' }[String(value).toLowerCase()] ?? String(value).toLowerCase());

function settingFindings(file, settings, truths) {
  return settings.map((entry) => ({ ...entry, value: normalised(entry.value) }))
    .filter((entry) => entry.value === RELAXING[entry.key] || (entry.key === 'if_ci_failed' && entry.value !== 'error'))
    .filter((entry) => !truths.settings.some((allow) => allow.key === entry.key && allow.value === entry.value))
    .map((entry) => finding('setting', file, entry.line, `${entry.key}: ${entry.value}`));
}

/** A strictness record is a finding unless the manifest allows that option at that value in that very file (the canon base tsconfig for skipLibCheck). */
function strictnessFindings(file, strictness, truths) {
  return strictness.filter((entry) => !truths.options.some((allow) => allow.key === entry.key && allow.value === entry.value && allow.files.includes(file)))
    .map((entry) => finding('strictness', file, entry.line, `${entry.key}: ${entry.value}`));
}

function configFindings(file, kind, text, truths, canon, withLists) {
  const records = configRecords(kind, text, file);
  return [
    ...(withLists ? listFindings(file, records.lists, truths, canon) : []),
    ...numberFindings(file, records.numbers),
    ...settingFindings(file, records.settings, truths),
    ...records.rulesOff.map((entry) => finding('rule-off', file, entry.line, entry.rule)),
    ...strictnessFindings(file, records.strictness, truths),
    ...records.budgets.map((entry) => finding('budget-override', file, entry.line, `${entry.key}: a budget is the canon's, never stated by a config`)),
    ...records.scope.map((entry) => finding('scope-override', file, entry.line, `${entry.key}: the canon config states no scope of what runs`)),
  ];
}

/** The gate limits of the file the manifest names (the Sonar gate): a floor lowered or a ceiling raised against the manifest's numbers. */
function limitFindings(file, text, limits) {
  const found = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const match = /^\s*(?:-\s+)?([A-Za-z]\w*)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?:#.*)?$/.exec(raw);
    if (!match) return;
    const value = Number(match[2]);
    const floor = limits.floors?.[match[1]];
    const ceiling = limits.ceilings?.[match[1]];
    if ((floor !== undefined && value < floor) || (ceiling !== undefined && value > ceiling)) found.push(finding('threshold', file, index + 1, `${match[1]} ${value}`));
  });
  return found;
}

function exceptionFileFindings(file, text, truths) {
  if (!truths.exceptionFiles.has(file)) return [finding('exception-file', file, 1, 'an exception, approval, allowlist or baseline file the design-truths manifest does not list')];
  const held = exceptionEntries(file, text);
  const allowed = truths.exceptionFiles.get(file);
  return held > allowed ? [finding('exception-file', file, 1, `${held} entries, the manifest allows ${allowed}`)] : [];
}

const FIXTURE_IMPORT = /fixtures\/loosening\//;
const PACKAGE_SPEC = /^packages\/hfs\/src\/[\w.-]+\.spec\.mjs$/;

/** The findings of one file. */
function fileFindings(file, text, truths, canon, withLists) {
  const found = bypassesIn(file, text).map((hit) => finding('bypass', file, hit.line, hit.label));
  const kind = configKindOf(file, text);
  if (kind) found.push(...configFindings(file, kind, text, truths, canon, withLists));
  if (isExceptionFile(file)) found.push(...exceptionFileFindings(file, text, truths));
  if (truths.limits?.file === file) found.push(...limitFindings(file, text, truths.limits));
  for (const pin of truths.budgets.filter((entry) => entry.file === file)) found.push(...budgetRecords(text, pin).map((detail) => finding('budget', file, 1, detail)));
  if (bypassFileKind(file, text) === 'code' && !PACKAGE_SPEC.test(file) && FIXTURE_IMPORT.test(text)) found.push(finding('fixture-misuse', file, 1, 'only a package spec of packages/hfs/src may import the fixtures of the loosening check'));
  return found;
}

/** The pinned files whose digest differs from the pin, and the declared fixtures and vendored copies the pins do not cover. */
function pinFindings(truths, pins, read) {
  const declared = [MANIFEST, ...truths.fixtureFiles, ...truths.vendored];
  const found = declared.filter((file) => !Object.hasOwn(pins, file)).map((file) => finding('pin', file, 1, 'no owner ruling pins this file: record its digest in an owner ruling'));
  for (const [file, digest] of Object.entries(pins)) {
    const text = read(file);
    if (typeof text !== 'string') found.push(finding('pin', file, 1, 'a pinned file is missing'));
    else if (truthsDigest(text) !== digest) found.push(finding('pin', file, 1, `its digest ${truthsDigest(text).slice(0, 12)} is not the one the owner pinned (${String(digest).slice(0, 12)}): only an owner ruling may change it`));
  }
  return found;
}

/**
 * Every loosening of the tree: [{id, kind, file, line, detail}] sorted, plus the manifest's own problems as `truths` findings.
 *   files   the tracked files (repository-relative, forward slashes);
 *   read    (file) -> text, or null when it cannot be read;
 *   truths  the manifest document (readTruths shapes it);
 *   canon   { derive(file, list) -> { by, items } | null }: what the canon derives for a list of a file, allowed only when the manifest names `by`;
 *   lists   false leaves the ignore and exclude lists out (the app gate: an app's rendered files are held to their render by the managed-file drift);
 *   pins    { path: sha256 } the latest owner ruling records; undefined skips the pin check (the app gate).
 */
export function stateFindings({ files, read, truths: doc, canon = {}, lists = true, pins }) {
  const truths = readTruths(doc);
  const found = truths.problems.map((problem) => finding('truths', MANIFEST, 1, problem));
  if (pins !== undefined) found.push(...pinFindings(truths, pins, read));
  for (const file of files) {
    if (!inScope(file, truths) || !isJudged(file, truths)) continue;
    const text = read(file);
    if (typeof text === 'string') found.push(...fileFindings(file, text, truths, canon, lists));
  }
  return found.sort((a, b) => byCodeUnit(a.id, b.id) || a.line - b.line);
}

/** One finding as the self-check and the app gate print it. */
export const findingLine = (entry) => `${entry.kind} ${entry.file}:${entry.line} ${entry.detail}`;
