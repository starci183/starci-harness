// stack-cutover.mts - the one reader of an environment's `cutover` declaration (.starcistacks/application-stacks.yaml
// `environments.<env>.cutover`, contexts/project/stacks.md PROJECT-STACKS-19). An app that lands the code of its next shape before an
// environment is cut over declares that environment `cutover: {state: pending, reason, until, keep?}`: `starci app check` then reports, for
// that environment alone, the findings the not-yet-cut-over state causes (the codes the failure-code catalog marks `cutoverTolerant`), and
// every deploying verb refuses the environment (STACK_CUTOVER_PENDING) until the cutover runbook removes the declaration. This file imports
// nothing of the kernel, like stack-declaration.mts, so the published @starci/hfs bundle carries it without the ledger.
import path from 'node:path';
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { DECLARATION, readDeclaration, STACK_ROOT, text, type ProfileProblem } from './stack-declaration.mjs';
import { isFile } from './fs-kind.mjs';

/** The states a cutover declaration may name: only `pending` (a cut-over environment carries no declaration). */
export const CUTOVER_STATES = Object.freeze(['pending'] as const);
/** The fields of a cutover declaration. */
const FIELDS = new Set(['state', 'reason', 'until', 'keep']);
/** `until` is one calendar date, `YYYY-MM-DD`. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
/** A kept entry: a sealed member's name, or `<member>/<KEY>` for one key of a member that also holds new keys. */
const KEPT = /^[a-z0-9][a-z0-9._-]*(?:\/[A-Za-z_][A-Za-z0-9_]*)?$/u;

/** One environment declared pending, as read. */
export interface CutoverDeclaration { env: string; state: 'pending'; reason: string; until: string; keep: string[]; expired: boolean }
/**
 * The cutover declarations of a stack declaration: `declared` holds every sound one (expired ones included, flagged), `present` every environment
 * that carries a `cutover` key at all (sound or not, the set every deploying verb refuses), `problems` every shape error. A declaration with a
 * problem tolerates nothing; an expired one tolerates nothing and is itself a blocking finding.
 */
export interface CutoverRead { declared: Record<string, CutoverDeclaration>; present: string[]; problems: ProfileProblem[] }

/** Today's date in UTC, `YYYY-MM-DD`: the clock the expiry reads (a declaration is valid through its `until` day). */
export const todayOf = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** True when `value` is a real calendar date written `YYYY-MM-DD`. */
function calendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Reads and judges one environment's `cutover` block; null with problems when it is unsound. */
function readOne(env: string, block: unknown, today: string, problem: (at: string, message: string) => void): CutoverDeclaration | null {
  const at = `environments.${env}.cutover`;
  let count = 0;
  const flag = (where: string, message: string): void => { count += 1; problem(where, message); };
  if (!plain(block)) { flag(at, 'cutover is { state: pending, reason: "<why>", until: <YYYY-MM-DD>, keep: [<old sealed member>] }'); return null; }
  for (const key of Object.keys(block)) if (!FIELDS.has(key)) flag(`${at}.${key}`, `${key} is not a field of a cutover declaration (state, reason, until, keep)`);
  const state = CUTOVER_STATES.find((candidate) => candidate === block['state']);
  if (state === undefined) flag(`${at}.state`, `state is ${JSON.stringify(block['state'] ?? null)}: the only state is pending (a cut-over environment carries no cutover block)`);
  const reason = text(block['reason']);
  if (reason === null) flag(`${at}.reason`, 'a pending cutover needs a reason: say in one short sentence what the environment waits for');
  const until = typeof block['until'] === 'string' ? block['until'] : block['until'] instanceof Date ? block['until'].toISOString().slice(0, 10) : null;
  if (until === null || !calendarDate(until)) flag(`${at}.until`, `until is ${JSON.stringify(block['until'] ?? null)}: the date the cutover is due, written YYYY-MM-DD`);
  const keepValue = block['keep'] ?? [];
  const keep: string[] = [];
  if (!Array.isArray(keepValue)) flag(`${at}.keep`, 'keep is a list of the old sealed members kept for rollback (<member> or <member>/<KEY>)');
  else for (const [index, entry] of keepValue.entries()) {
    if (typeof entry !== 'string' || !KEPT.test(entry)) flag(`${at}.keep[${String(index)}]`, `${JSON.stringify(entry)} is not a sealed member name (<member> or <member>/<KEY>)`);
    else if (keep.includes(entry)) flag(`${at}.keep[${String(index)}]`, `${entry} is listed twice`);
    else keep.push(entry);
  }
  if (count > 0 || state === undefined || reason === null || until === null) return null;
  return { env, state, reason, until, keep, expired: until < today };
}

/** The cutover declarations of a parsed stack declaration, judged against `today` (YYYY-MM-DD, UTC). */
export function readCutoverDeclarations(doc: unknown, today: string = todayOf()): CutoverRead {
  const result: CutoverRead = { declared: {}, present: [], problems: [] };
  const environments = plain(doc) ? doc['environments'] : undefined;
  if (!plain(environments)) return result;
  const problem = (at: string, message: string): void => { result.problems.push({ at, message }); };
  for (const [env, spec] of Object.entries(environments)) {
    if (!plain(spec) || !Object.hasOwn(spec, 'cutover')) continue;
    result.present.push(env);
    const one = readOne(env, spec['cutover'], today, problem);
    if (one !== null) result.declared[env] = one;
  }
  return result;
}

/** The cutover declarations of the app at `repoRoot` (none when it declares no stack or the file does not parse). */
export function declaredCutovers(repoRoot: unknown, today: string = todayOf()): CutoverRead {
  const file = path.join(path.resolve(String(repoRoot ?? '')), STACK_ROOT, DECLARATION);
  if (!isFile(file)) return { declared: {}, present: [], problems: [] };
  const read = readDeclaration(file);
  return read.doc === undefined ? { declared: {}, present: [], problems: [] } : readCutoverDeclarations(read.doc, today);
}

/** The environments still waiting for their cutover: sound and not expired, the only ones whose tolerated findings are reported instead of blocking. */
export const pendingCutovers = (read: CutoverRead): CutoverDeclaration[] => Object.values(read.declared).filter((entry) => !entry.expired);
