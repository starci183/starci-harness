// stack-config-kit.mjs - the small validators the deploy block (stack-deploy-config.mjs) and its ingress block (stack-ingress-config.mjs)
// share: a problem collector, closed field lists, pattern checks and the environment-relative file check.
import path from 'node:path';
import { isPlainObject as plain } from '../../engine/plain-object.mjs';

/** One problem: the path it concerns and the message. */
export interface StackProblem { at: string; message: string }

/** What `collector()` returns. */
export interface Collector { problems: StackProblem[]; problem: (at: string, message: string) => void }

/** The environment-relative file probe the deploy block receives. */
export interface TreeProbe { exists: (file: string) => boolean }

const BACKSLASH = String.fromCodePoint(92);

/** Collects problems with the path they concern; `problem(at, message)` is the only way to add one. */
export function collector(): Collector {
  const problems: StackProblem[] = [];
  return { problems, problem: (at: string, message: string): void => { problems.push({ at, message }); } };
}

/** True for a mapping; reports every key outside `allowed` as "not a field of the <label> block". */
export function closedFields(c: Collector, at: string, value: unknown, allowed: readonly string[], label = 'deploy'): boolean {
  if (!plain(value)) { c.problem(at, 'must be a mapping'); return false; }
  for (const key of Object.keys(value as Record<string, unknown>)) if (!allowed.includes(key)) c.problem(`${at}.${key}`, `is not a field of the ${label} block`);
  return true;
}

/** True when `value` is a string matching `pattern`; otherwise reports it. */
export function patternField(c: Collector, at: string, value: unknown, pattern: RegExp): boolean {
  if (typeof value !== 'string' || !pattern.test(value)) { c.problem(at, `must match ${pattern}`); return false; }
  return true;
}

/** A path inside .starcistacks/<env>/ : relative, forward slashes, no `..`, and present in the tree. */
export function treeFile(c: Collector, at: string, value: unknown, probe: TreeProbe): void {
  if (typeof value !== 'string' || value === '' || path.posix.isAbsolute(value) || value.includes(BACKSLASH) || path.posix.normalize(value).split('/').includes('..')) {
    c.problem(at, 'must be a relative path inside the environment directory');
    return;
  }
  if (!probe.exists(value)) c.problem(at, `${value} does not exist under the environment directory`);
}
