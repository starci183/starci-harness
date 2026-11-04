// stack-declaration.mjs - the one reader of a repository's stack declaration (.starcistacks/application-stacks.yaml): where it
// lives, its bounded read and parse, and the stack block of one service as declared. scripts/gates/starcistacks.mjs (the
// services contract) and scripts/hfs/rules/stacks.mjs (the .starcistacks shape, R10) both read it here; this file imports
// nothing of the kernel, so the published @starci/hfs bundle carries it without the ledger.
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { parseYaml } from '../../engine/yaml.mjs';
import { isDir, isFile } from './fs-kind.mjs';
import { posixPath } from './path-key.mjs';

export const DECLARATION = 'application-stacks.yaml';
/** The one stack root a repository owns. */
export const STACK_ROOT = '.starcistacks';
const MAX_BYTES = 2 * 1024 * 1024;

/** A non-blank string, trimmed; anything else is null. */
export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The text of `file`, or null when it is absent or larger than 2 MiB. */
export const readText = (file: string): string | null => { try { return fs.statSync(file).size > MAX_BYTES ? null : fs.readFileSync(file, 'utf8'); } catch { return null; } };

/** A parsed YAML mapping (the declaration document). */
export type DeclarationDoc = Record<string, unknown>;
/** The read of a declaration file. */
export type DeclarationRead = { doc: DeclarationDoc; error?: undefined } | { error: string; doc?: undefined };
/** The stack declaration a repository owns, or {missing:true} when it declares none. */
export type StackDeclaration =
  | ({ repo: string; root: string; file: string; rooted: boolean } & DeclarationRead)
  | { repo: string; missing: true; rooted: boolean; root?: undefined; file?: undefined; doc?: undefined; error?: undefined };
/** The stack block of one declared service. */
export interface DeclaredStack { owner: string | null; root: string | null; repository: string | null; hostOwned: boolean }

/** The parsed declaration file: {doc} or {error}. */
export function readDeclaration(file: string): DeclarationRead {
  const raw = readText(file);
  if (raw === null) return { error: 'unreadable or larger than 2 MiB' };
  try { const doc = parseYaml(raw); return plain(doc) ? { doc } : { error: 'not a YAML mapping' }; }
  catch (error) { return { error: `YAML does not parse: ${String((error as { message?: unknown } | null)?.message ?? error).split('\n')[0]}` }; }
}

/**
 * The stack declaration a repository owns: {root, file, rooted, doc|error} - or {missing:true, rooted}
 * when .starcistacks/application-stacks.yaml does not exist. `rooted` says the .starcistacks tree exists.
 */
export function findStackDeclaration(repoRoot: unknown): StackDeclaration {
  const repo = path.resolve(String(repoRoot ?? ''));
  const rooted = isDir(path.join(repo, STACK_ROOT));
  const file = path.join(repo, STACK_ROOT, DECLARATION);
  if (isFile(file)) return { repo, root: STACK_ROOT, file, rooted, ...readDeclaration(file) };
  return { repo, missing: true, rooted };
}

/**
 * The stack block of one declared service, or null when it has none: {owner, root, repository, hostOwned}. A stack is
 * host-owned when it says `owner: host` (it lives in the installed runtime tree, `.claude/ext/<service>`); `root` is posix.
 */
export function declaredStack(entry: unknown): DeclaredStack | null {
  const stack = (plain(entry) && plain((entry as Record<string, unknown>)['stack']) ? (entry as Record<string, unknown>)['stack'] : null) as Record<string, unknown> | null;
  if (!stack) return null;
  const root = text(stack.root);
  return { owner: text(stack.owner), root: root === null ? null : posixPath(root), repository: text(stack.repository), hostOwned: text(stack.owner) === 'host' };
}

/** The gates a branch profile names: every gate `starci app check --gate` selects. */
export const PROFILE_GATES = Object.freeze(['hfs', 'format', 'db', 'secrets', 'wiring', 'types', 'lint', 'test', 'sonar', 'codecov'] as const);
/** One gate a branch profile names. */
export type ProfileGate = (typeof PROFILE_GATES)[number];
/** The polish gates, the only ones a branch profile may lower; every other gate (hfs, types, wiring, db, secrets, format, test) blocks on every branch. */
export const POLISH_GATES: ReadonlySet<ProfileGate> = Object.freeze(new Set<ProfileGate>(['lint', 'sonar', 'codecov']));
/** How a branch profile runs a gate: its findings count (blocking), are printed and recorded but never count (report), or it does not run (off). */
export const GATE_MODES = Object.freeze(['blocking', 'report', 'off'] as const);
/** One gate mode. */
export type GateMode = (typeof GATE_MODES)[number];
/** The branches that are the default branch whatever the declaration says: a profile never names them. */
const DEFAULT_BRANCHES = Object.freeze(['main', 'master']);
/** A branch name a profile may declare: one git ref segment path, no glob and no leading dash. */
const BRANCH_NAME = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/u;

/**
 * What policy/loosening.yaml `branchProfiles` allows (the harness CLI hands it in as STARCI_PROFILE_BRANCHES and STARCI_PROFILE_GATES): the branches
 * that may carry a profile and the polish gates they may lower. A run outside the CLI takes that file's own value.
 */
export interface ProfilePolicy { branches: readonly string[]; gates: ReadonlySet<ProfileGate> }
const listEnv = (value: string | undefined): string[] | null => (value === undefined ? null : value.split(',').map((item) => item.trim()).filter(Boolean));
/** The profile policy in force: the CLI's, else the runtime's policy/loosening.yaml value (branch dev, gates lint, sonar, codecov); never a gate outside POLISH_GATES. */
export function profilePolicy(env: NodeJS.ProcessEnv = process.env): ProfilePolicy {
  const gates = (listEnv(env.STARCI_PROFILE_GATES) ?? [...POLISH_GATES]).filter((gate): gate is ProfileGate => POLISH_GATES.has(gate as ProfileGate));
  return { branches: listEnv(env.STARCI_PROFILE_BRANCHES) ?? ['dev'], gates: new Set(gates) };
}

/** A problem of the `branches` block: where (a path inside the declaration) and why. */
export interface ProfileProblem { at: string; message: string }
/** The branch profiles a declaration states: each branch's mode per gate it names (a gate it leaves out blocks), the default branch, and every problem. */
export interface BranchProfiles { profiles: Record<string, Partial<Record<ProfileGate, GateMode>>>; defaultBranch: string; problems: ProfileProblem[] }

/** The default branch of a declaration: ci.github.defaultBranch, else main. */
export const declaredDefaultBranch = (doc: unknown): string => text((plain(doc) && plain(doc['ci']) && plain((doc['ci'] as Record<string, unknown>)['github']) ? ((doc['ci'] as Record<string, Record<string, unknown>>)['github'] as Record<string, unknown>)['defaultBranch'] : null)) ?? 'main';

/**
 * The `branches` block of a stack declaration (`branches: { dev: { gates: { lint: report, sonar: report } } }`), read and judged: a branch
 * the policy does not list, the default branch (main, master or ci.github.defaultBranch) and a gate other than the polish gates set to anything
 * but blocking are problems, and so is every shape error. The reader keeps only the sound profiles, so a refused one never lowers a gate.
 */
export function readBranchProfiles(doc: unknown, policy: ProfilePolicy = profilePolicy()): BranchProfiles {
  const defaultBranch = declaredDefaultBranch(doc);
  const result: BranchProfiles = { profiles: {}, defaultBranch, problems: [] };
  const block = plain(doc) ? doc['branches'] : undefined;
  if (block === undefined) return result;
  const problem = (at: string, message: string): void => { result.problems.push({ at, message }); };
  if (!plain(block)) { problem('branches', 'branches is a mapping of branch name to { gates }'); return result; }
  const defaults = new Set([...DEFAULT_BRANCHES, defaultBranch]);
  for (const [branch, entry] of Object.entries(block)) {
    const at = `branches.${branch}`;
    const before = result.problems.length;
    if (defaults.has(branch)) problem(at, `${branch} is the default branch: it always runs the full gate and is never declared or lowered`);
    else if (!BRANCH_NAME.test(branch)) problem(at, `${branch} is not a branch name (letters, digits, . _ / -, no glob)`);
    else if (!policy.branches.includes(branch)) problem(at, `${branch} may not carry a branch profile: policy/loosening.yaml branchProfiles allows ${policy.branches.join(', ') || 'none'}`);
    if (!plain(entry) || Object.keys(entry).some((key) => key !== 'gates') || !plain(entry['gates'])) { problem(at, 'a branch profile is { gates: { <gate>: blocking|report|off } }'); continue; }
    const gates: Partial<Record<ProfileGate, GateMode>> = {};
    for (const [gate, mode] of Object.entries(entry['gates'] as Record<string, unknown>)) {
      const where = `${at}.gates.${gate}`;
      const known = PROFILE_GATES.find((candidate) => candidate === gate);
      const chosen = GATE_MODES.find((candidate) => candidate === mode);
      if (known === undefined) problem(where, `${gate} is not a gate (${PROFILE_GATES.join(', ')})`);
      else if (chosen === undefined) problem(where, `${String(mode)} is not a gate mode (${GATE_MODES.join(', ')})`);
      else if (chosen !== 'blocking' && !POLISH_GATES.has(known)) problem(where, `${gate} is a safety gate: it blocks on every branch and is never lowered (only ${[...POLISH_GATES].join(', ')} may be)`);
      else if (chosen !== 'blocking' && !policy.gates.has(known)) problem(where, `${gate} may not be lowered: policy/loosening.yaml branchProfiles allows ${[...policy.gates].join(', ') || 'none'}`);
      else gates[known] = chosen;
    }
    if (result.problems.length === before) result.profiles[branch] = gates;
  }
  return result;
}
