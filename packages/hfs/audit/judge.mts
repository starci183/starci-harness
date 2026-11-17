// judge.mts - the production dependency audit judged against the app's time-boxed exceptions (contexts/project/lint.md PROJECT-LINT-5).
//
// The input is what `npm audit --omit=dev --json` prints (the npm 7+ report: `vulnerabilities[name].{severity, via[], effects[], fixAvailable, nodes}`),
// the app's package-lock.json and `.starcistacks/security/audit-exceptions.yaml`. The output is a list of findings; any `error` fails the gate.
//
// A finding is one advisory of one package (a `via` entry of the report that is an object, never the bare package names npm lists for a package that is
// only vulnerable through another one; those take their verdict from the advisory they come from). A finding at or above the declared level fails with
// AUDIT_HIGH unless an active exception exempts it. An exception exempts a finding when ALL hold:
//   - its `advisory` is the finding's GHSA id and its `package` the finding's package, both exact (no wildcard, no range);
//   - it is active: valid, not expired, no longer than 14 days from approval to expiry, and npm reports no fix for the package. A fix is npm's
//     `fixAvailable: true`, a non-major update, or a major update of the vulnerable package itself; a semver-major change of ANOTHER package (npm
//     offering to move a parent, often backwards) is not a fix of this one and is only reported beside the active exception;
//   - every dependency path to the package passes through one of its `via` packages before it. The paths are read from the lockfile, never from
//     the report: the root nodes are the root package and each workspace package, and the tree is walked from each root's dependencies (its
//     `devDependencies` too when the audit does not omit dev) as Node resolves it (the `node_modules` beside the requirer, then each parent's).
//     A second walk stops at every package named in `via`; a node of the finding that walk still reaches has a path that touches no `via`
//     package, and a node the first walk never reaches has a path the lockfile cannot resolve: either way the finding fails.
// An exception that is expired, too long, or whose package has a fix is an error of its own; one that matches no finding at or above the level is unused,
// also an error (remove it). Every active exception that exempted something is reported, so an exception is never hidden.
import { parseYaml } from '../runtime/engine/yaml.mjs';

export const AUDIT_HIGH = 'AUDIT_HIGH';
export const AUDIT_EXCEPTION_INVALID = 'AUDIT_EXCEPTION_INVALID';
export const AUDIT_EXCEPTION_EXPIRED = 'AUDIT_EXCEPTION_EXPIRED';
export const AUDIT_EXCEPTION_TOO_LONG = 'AUDIT_EXCEPTION_TOO_LONG';
export const AUDIT_EXCEPTION_FIX_AVAILABLE = 'AUDIT_EXCEPTION_FIX_AVAILABLE';
export const AUDIT_EXCEPTION_UNUSED = 'AUDIT_EXCEPTION_UNUSED';
export const AUDIT_EXCEPTION_ACTIVE = 'AUDIT_EXCEPTION_ACTIVE';
export const AUDIT_REPORT_UNREADABLE = 'AUDIT_REPORT_UNREADABLE';

/** The file of the exceptions, app-relative. */
export const EXCEPTIONS_FILE = '.starcistacks/security/audit-exceptions.yaml';
/** The longest an exception may live, from `approvedAt` to `expires`. */
export const MAX_EXCEPTION_DAYS = 14;
const DAY_MS = 86_400_000;

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'] as const;
export type AuditLevel = (typeof LEVELS)[number];

const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const GHSA_IN_URL = /GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}/i;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** One exception of the file, read and checked. */
export interface AuditException {
  readonly advisory: string;
  readonly package: string;
  readonly via: readonly string[];
  readonly reason: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly expires: string;
}

/** One line of the verdict. `error` fails the gate; `info` is printed and never fails it. */
export interface AuditFinding {
  readonly code: string;
  readonly level: 'error' | 'info';
  readonly message: string;
}

/** The shape of one `package-lock.json` entry the judge reads. */
interface LockEntry {
  readonly name?: string;
  readonly link?: boolean;
  readonly resolved?: string;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}
export interface Lockfile { readonly packages?: Record<string, LockEntry> }

/** The report of `npm audit --json` (npm 7+). */
interface ReportVia { readonly source?: number; readonly name?: string; readonly title?: string; readonly url?: string; readonly severity?: string }
interface ReportVulnerability {
  readonly name?: string;
  readonly severity?: string;
  readonly via?: readonly (string | ReportVia)[];
  readonly fixAvailable?: unknown;
  readonly nodes?: readonly string[];
}
export interface AuditReport { readonly vulnerabilities?: Record<string, ReportVulnerability>; readonly error?: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const rank = (severity: unknown): number => LEVELS.indexOf(severity as AuditLevel);
export const isAuditLevel = (value: unknown): value is AuditLevel => LEVELS.includes(value as AuditLevel);

/** The error of one malformed entry (or of the file), as the finding every reader prints. */
const invalid = (message: string): AuditFinding => ({ code: AUDIT_EXCEPTION_INVALID, level: 'error', message: `${EXCEPTIONS_FILE}: ${message}` });

function entryProblem(entry: unknown): string | null {
  if (!isRecord(entry)) return 'is not a mapping';
  const unknown = Object.keys(entry).filter((key) => !['advisory', 'package', 'via', 'reason', 'approvedBy', 'approvedAt', 'expires'].includes(key));
  if (unknown.length > 0) return `has unknown key ${unknown.join(', ')}`;
  if (typeof entry['advisory'] !== 'string' || !GHSA.test(entry['advisory'])) return 'advisory must be one exact GHSA id (no wildcard)';
  if (!nonEmpty(entry['package']) || /[\s*?]/.test(entry['package'])) return 'package must be one exact npm package name';
  const via = entry['via'];
  if (!Array.isArray(via) || via.length === 0 || !via.every((name) => nonEmpty(name) && !/[\s*?]/.test(name))) return 'via must be a non-empty list of package names a path passes through';
  for (const key of ['reason', 'approvedBy'] as const) if (!nonEmpty(entry[key])) return `${key} must be a non-empty string`;
  for (const key of ['approvedAt', 'expires'] as const) {
    const value = entry[key];
    if (typeof value !== 'string' || !ZONED.test(value) || Number.isNaN(Date.parse(value))) return `${key} must be an ISO timestamp with a zone (2026-11-18T09:00:00+07:00)`;
  }
  return null;
}

/** The exceptions of the file's text and the errors of what is malformed; an absent file (`text` undefined) holds none. */
export function parseExceptions(text: string | undefined): { exceptions: AuditException[]; findings: AuditFinding[] } {
  if (text === undefined || text.trim() === '') return { exceptions: [], findings: [] };
  let document: unknown;
  try { document = parseYaml(text); } catch (error) { return { exceptions: [], findings: [invalid(`is not valid YAML (${(error as Error).message})`)] }; }
  if (document === null || document === undefined) return { exceptions: [], findings: [] };
  if (!Array.isArray(document)) return { exceptions: [], findings: [invalid('must be a list of exceptions')] };
  const exceptions: AuditException[] = [];
  const findings: AuditFinding[] = [];
  document.forEach((entry: unknown, index: number) => {
    const problem = entryProblem(entry);
    if (problem !== null) findings.push(invalid(`entry ${String(index + 1)} ${problem}`));
    else exceptions.push(entry as AuditException);
  });
  return { exceptions, findings };
}

/** One advisory of one package at or above the level, with the lock paths the report names for the package. */
interface Finding { readonly id: string; readonly pkg: string; readonly severity: string; readonly title: string; readonly nodes: readonly string[]; readonly fix: boolean; readonly breaking?: string }

/** Whether npm's `fixAvailable` fixes `pkg`: true, a non-major update, or a major update of `pkg` itself. A breaking change of another package is not. */
export function fixOf(fixAvailable: unknown, pkg: string): { fix: boolean; breaking?: string } {
  if (fixAvailable === true) return { fix: true };
  if (!isRecord(fixAvailable)) return { fix: false };
  const name = typeof fixAvailable['name'] === 'string' ? fixAvailable['name'] : undefined;
  const version = typeof fixAvailable['version'] === 'string' ? fixAvailable['version'] : '?';
  if (fixAvailable['isSemVerMajor'] !== true || name === pkg) return { fix: true };
  return { fix: false, breaking: `npm only offers a breaking change of ${name ?? 'another package'} to ${version}, not a fix of ${pkg}` };
}

function findingsOf(report: AuditReport, level: AuditLevel): Finding[] {
  const found: Finding[] = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === 'string' || rank(via.severity) < rank(level)) continue;
      const id = GHSA_IN_URL.exec(via.url ?? '')?.[0];
      found.push({
        id: id === undefined ? `npm:${String(via.source ?? via.title ?? 'unknown')}` : `GHSA-${id.slice(5).toLowerCase()}`,
        pkg: via.name ?? name, severity: String(via.severity), title: String(via.title ?? ''),
        nodes: vulnerability.nodes ?? [], ...fixOf(vulnerability.fixAvailable, via.name ?? name),
      });
    }
  }
  return found;
}

/** For each lock path, the root dependency names it is reached from. Built once per audit. */
/** The package name of a lock key: the segment after the last `node_modules/` (scoped names keep their scope), else the entry's `name`. */
const nameOfKey = (key: string, entry: LockEntry | undefined): string => {
  const cut = key.lastIndexOf('node_modules/');
  if (cut >= 0) return key.slice(cut + 'node_modules/'.length);
  return entry?.name ?? key;
};

/** For each lock path, the root dependency names it is reached from. With `avoid`, the walk never enters a package so named. Built once per audit. */
export function rootsReaching(lock: Lockfile | undefined, omitDev: boolean, avoid: ReadonlySet<string> = new Set()): Map<string, Set<string>> {
  const reached = new Map<string, Set<string>>();
  const packages = lock?.packages;
  if (!isRecord(packages)) return reached;
  const lockEntries = packages as Record<string, LockEntry>;
  const workspaceTargets = new Set(Object.values(lockEntries).filter((entry) => entry.link === true && typeof entry.resolved === 'string').map((entry) => entry.resolved as string));
  // The root nodes: the root package and every workspace package (a folder entry no `node_modules` segment sits in).
  const roots = Object.keys(lockEntries).filter((key) => key === '' || workspaceTargets.has(key));
  const resolve = (from: string, name: string): string | undefined => {
    let base = from;
    for (;;) {
      const candidate = base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`;
      if (candidate in lockEntries) {
        const entry = lockEntries[candidate] as LockEntry;
        return entry.link === true && typeof entry.resolved === 'string' ? entry.resolved : candidate;
      }
      const cut = base.lastIndexOf('/node_modules/');
      if (cut >= 0) base = base.slice(0, cut);
      else if (base.startsWith('node_modules/')) base = '';
      else if (base === '') return undefined;
      else base = '';
    }
  };
  const edges = (key: string): string[] => {
    const entry = lockEntries[key] as LockEntry;
    return [...Object.keys(entry.dependencies ?? {}), ...Object.keys(entry.optionalDependencies ?? {}), ...Object.keys(entry.peerDependencies ?? {})];
  };
  for (const rootKey of roots) {
    const root = lockEntries[rootKey] as LockEntry;
    if (rootKey !== '' && avoid.has(nameOfKey(rootKey, root))) continue;
    const direct = [...edges(rootKey), ...(omitDev ? [] : Object.keys(root.devDependencies ?? {}))];
    for (const name of direct) {
      const start = resolve(rootKey, name);
      if (start === undefined || avoid.has(nameOfKey(start, lockEntries[start]))) continue;
      const seen = new Set<string>();
      const stack = [start];
      for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
        if (seen.has(key)) continue;
        seen.add(key);
        const set = reached.get(key) ?? new Set<string>();
        set.add(name);
        reached.set(key, set);
        for (const dependency of edges(key)) {
          const next = resolve(key, dependency);
          if (next !== undefined && !avoid.has(nameOfKey(next, lockEntries[next]))) stack.push(next);
        }
      }
    }
  }
  return reached;
}

/** The lock paths of a vulnerable package when the report names none: every `node_modules/**` entry of that name. */
const nodesNamed = (lock: Lockfile | undefined, name: string): string[] => Object.keys(lock?.packages ?? {}).filter((key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));

const daysLeft = (expires: string, now: Date): number => Math.max(0, Math.ceil((Date.parse(expires) - now.getTime()) / DAY_MS));

export interface JudgeInput {
  readonly report: AuditReport;
  readonly lock?: Lockfile | undefined;
  /** The text of the exceptions file, or undefined when it is absent. */
  readonly exceptionsText?: string | undefined;
  readonly level: AuditLevel;
  readonly omitDev: boolean;
  readonly now: Date;
}

/** The verdict: every finding, in a stable order (the file's, then the audit's, then the active ones). */
export function judge({ report, lock, exceptionsText, level, omitDev, now }: JudgeInput): AuditFinding[] {
  const out: AuditFinding[] = [];
  const parsed = parseExceptions(exceptionsText);
  out.push(...parsed.findings);
  const found = findingsOf(report, level);
  const reaching = rootsReaching(lock, omitDev);
  const used = new Set<AuditException>();
  const exempting = new Set<AuditException>();
  // What each exception is, by its own merits: only an active one can exempt.
  const active = new Set<AuditException>();
  for (const exception of parsed.exceptions) {
    const where = `${exception.package} ${exception.advisory}`;
    const expires = Date.parse(exception.expires);
    const approved = Date.parse(exception.approvedAt);
    let ok = true;
    if (expires <= now.getTime()) { ok = false; out.push({ code: AUDIT_EXCEPTION_EXPIRED, level: 'error', message: `exception ${where} expired at ${exception.expires}: remove it, or fix the dependency` }); }
    if (expires - approved > MAX_EXCEPTION_DAYS * DAY_MS) { ok = false; out.push({ code: AUDIT_EXCEPTION_TOO_LONG, level: 'error', message: `exception ${where} lasts more than ${String(MAX_EXCEPTION_DAYS)} days (${exception.approvedAt} to ${exception.expires}): an exception is at most ${String(MAX_EXCEPTION_DAYS)} days` }); }
    if (found.some((each) => each.id === exception.advisory && each.pkg === exception.package && each.fix)) { ok = false; out.push({ code: AUDIT_EXCEPTION_FIX_AVAILABLE, level: 'error', message: `exception ${where}: npm reports a fix for ${exception.package}; upgrade it and remove the exception` }); }
    if (ok) active.add(exception);
  }
  for (const finding of found) {
    const matching = parsed.exceptions.filter((exception) => exception.advisory === finding.id && exception.package === finding.pkg);
    for (const exception of matching) used.add(exception);
    const nodes = finding.nodes.length > 0 ? finding.nodes : nodesNamed(lock, finding.pkg);
    const roots = new Set<string>();
    let unresolved = nodes.length === 0;
    for (const node of nodes) {
      const from = reaching.get(node);
      if (from === undefined || from.size === 0) unresolved = true;
      else for (const name of from) roots.add(name);
    }
    const base = `${finding.pkg} ${finding.severity} ${finding.id}${finding.title === '' ? '' : ` (${finding.title})`}`;
    // A node still reached when the walk stops at every via package (the vulnerable package itself never counts as its own via) has a path that touches none.
    const bypassOf = (exception: AuditException): string[] => {
      const avoid = new Set(exception.via.filter((name) => name !== finding.pkg));
      const around = rootsReaching(lock, omitDev, avoid);
      return [...new Set(nodes.flatMap((node) => [...(around.get(node) ?? [])]))].sort();
    };
    let bypass: string[] = [];
    const exemptBy = matching.find((exception) => {
      if (!active.has(exception) || unresolved) return false;
      bypass = bypassOf(exception);
      return bypass.length === 0;
    });
    if (exemptBy !== undefined) { exempting.add(exemptBy); continue; }
    let why = 'no exception covers it';
    if (matching.length > 0) {
      if (unresolved) why = 'the lockfile does not resolve every dependency path to it, so no exception covers it';
      else if (!matching.some((exception) => active.has(exception))) why = 'its exception is not active';
      else why = `a path to it passes through none of the exception's via packages [from: ${bypass.join(', ')}]`;
    }
    out.push({ code: AUDIT_HIGH, level: 'error', message: `${base}: ${why}${roots.size > 0 ? ` [reached from: ${[...roots].sort().join(', ')}]` : ''}` });
  }
  for (const exception of parsed.exceptions) {
    if (!used.has(exception)) out.push({ code: AUDIT_EXCEPTION_UNUSED, level: 'error', message: `exception ${exception.package} ${exception.advisory} matches no finding at or above ${level}: remove it` });
  }
  for (const exception of exempting) {
    const breaking = found.find((each) => each.id === exception.advisory && each.pkg === exception.package && each.breaking !== undefined)?.breaking;
    out.push({ code: AUDIT_EXCEPTION_ACTIVE, level: 'info', message: `active exception: advisory ${exception.advisory}, package ${exception.package}, via ${exception.via.join(', ')}, reason "${exception.reason}", approved by ${exception.approvedBy}, expires ${exception.expires} (${String(daysLeft(exception.expires, now))} day(s) left)${breaking === undefined ? '' : `; ${breaking}`}` });
  }
  return out;
}

/** The report of the text `npm audit --json` printed, or the error that says why it is not one. */
export function readReport(text: string): { report?: AuditReport; error?: string } {
  let parsedReport: unknown;
  try { parsedReport = JSON.parse(text); } catch { return { error: 'npm audit printed no JSON report' }; }
  if (!isRecord(parsedReport)) return { error: 'npm audit printed no JSON report' };
  if (parsedReport['error'] !== undefined) {
    const detail = isRecord(parsedReport['error']) ? String(parsedReport['error']['summary'] ?? parsedReport['error']['code'] ?? 'unknown error') : String(parsedReport['error']);
    return { error: `npm audit failed: ${detail}` };
  }
  if (!isRecord(parsedReport['vulnerabilities'])) return { error: 'npm audit printed a JSON report with no vulnerabilities map' };
  return { report: parsedReport as AuditReport };
}
