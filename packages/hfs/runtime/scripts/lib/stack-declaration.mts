// stack-declaration.mts - the one reader of a repository's stack declaration (.starcistacks/application-stacks.yaml): where it
// lives, its bounded read and parse, and the stack block of one service as declared. scripts/gates/starcistacks.mts (the
// services contract) and scripts/hfs/rules/stacks.mts (the .starcistacks shape, R10) both read it here; this file imports
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

/**
 * The gates of a run: every gate `starci app check --gate` selects, and the three steps and checks that run inside another gate or beside the app check and have a
 * mode of their own: `checks` (the project's own ext checks, inside the hfs run), `coverage` (the per-file threshold proof, inside the test run) and `deps`
 * (`starci deps check`, the pre-push pin check).
 */
export const PROFILE_GATES = Object.freeze(['hfs', 'format', 'db', 'secrets', 'wiring', 'types', 'lint', 'test', 'sonar', 'codecov', 'build', 'audit', 'checks', 'coverage', 'deps'] as const);
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
 * A branch pattern a profile may declare instead of one name (`ui/*`): a literal first segment, then `/` and segments in which `*` stands for any characters
 * but `/` (the meaning GitHub gives `*` in a push filter). The literal first segment keeps a pattern off every one-segment branch, the default branch among them,
 * and off the release candidates (`release/...`); a pattern that still matches a default branch is refused by the reader.
 */
const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)(?!.*\*\*)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._*-]+)+$/u;
/** True when `name` is a branch pattern (it holds `*`) rather than one branch name. */
export const isBranchPattern = (name: string): boolean => name.includes('*');
const escapeRegExp = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/gu, '\\$&');
/** True when `branch` is `pattern`, or `pattern` holds `*` and matches it segment by segment (`*` any characters but `/`). */
export function matchesBranch(pattern: string, branch: string): boolean {
  if (!isBranchPattern(pattern)) return pattern === branch;
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[^/]+')}$`, 'u').test(branch);
}
/** True when the policy's list `allowed` lets `branch` (a name or a pattern) carry a profile: listed as written, or a name a listed pattern matches. */
const allowedBy = (allowed: readonly string[], branch: string): boolean => allowed.includes(branch) || (!isBranchPattern(branch) && allowed.some((entry) => isBranchPattern(entry) && matchesBranch(entry, branch)));

/**
 * What policy/loosening.yaml `branchProfiles` allows (the harness CLI hands it in as STARCI_PROFILE_BRANCHES and STARCI_PROFILE_GATES): the branches
 * that may carry a profile and the polish gates they may lower. A run outside the CLI takes that file's own value.
 */
export interface ProfilePolicy { branches: readonly string[]; gates: ReadonlySet<ProfileGate> }
const listEnv = (value: string | undefined): string[] | null => (value === undefined ? null : value.split(',').map((item) => item.trim()).filter(Boolean));
/** The profile policy in force: the CLI's, else the runtime's policy/loosening.yaml value (branches dev and ui/*, gates lint, sonar, codecov); never a gate outside POLISH_GATES. */
export function profilePolicy(env: NodeJS.ProcessEnv = process.env): ProfilePolicy {
  const gates = (listEnv(env.STARCI_PROFILE_GATES) ?? [...POLISH_GATES]).filter((gate): gate is ProfileGate => POLISH_GATES.has(gate as ProfileGate));
  return { branches: listEnv(env.STARCI_PROFILE_BRANCHES) ?? ['dev', 'ui/*'], gates: new Set(gates) };
}

/** A problem of the `branches` block: where (a path inside the declaration) and why. */
export interface ProfileProblem { at: string; message: string }
/** The branch profiles a declaration states: each branch's mode per gate it names (a gate it leaves out blocks), the default branch, and every problem. */
export interface BranchProfiles { profiles: Record<string, Partial<Record<ProfileGate, GateMode>>>; defaultBranch: string; problems: ProfileProblem[] }

/**
 * The profile a branch is under and the declaration key that gave it: the branch's own entry, else every pattern that matches it, merged gate by gate
 * to the stricter mode (blocking over report over off), so two patterns never lower more than either; null when none applies.
 */
export function profileFor(profiles: BranchProfiles['profiles'], branch: string): { key: string; gates: Partial<Record<ProfileGate, GateMode>> } | null {
  const own = Object.hasOwn(profiles, branch) && !isBranchPattern(branch) ? profiles[branch] : undefined;
  if (own !== undefined) return { key: branch, gates: own };
  const matching = Object.keys(profiles).filter((key) => isBranchPattern(key) && matchesBranch(key, branch)).sort();
  if (matching.length === 0) return null;
  const rank: Record<GateMode, number> = { off: 0, report: 1, blocking: 2 };
  const gates: Partial<Record<ProfileGate, GateMode>> = {};
  for (const gate of PROFILE_GATES) {
    const modes = matching.map((key) => profiles[key]?.[gate] ?? 'blocking');
    const strictest = modes.reduce((a, b) => (rank[a] >= rank[b] ? a : b));
    if (strictest !== 'blocking') gates[gate] = strictest;
  }
  return { key: matching.join(' + '), gates };
}

/**
 * The gates an app never switches off (`gates` of the declaration, PROJECT-LINT-4), whatever the declaration says: the three the harness itself judges, the rules of @starci/hfs.
 * `hfs` (structure, slots, stacks, naming, managed-file drift, the bypass markers, the project ext rules), `secrets` (the secret scan and the sealed-secret custody) and `db` (the
 * migration shape, sealing and row-level-security rules). Every other gate is the app's own to run or not.
 */
export const HFS_GATES: ReadonlySet<ProfileGate> = Object.freeze(new Set<ProfileGate>(['hfs', 'secrets', 'db']));
/** The gates an app may switch off for the whole app: every gate that is not an hfs gate. */
export const OPTIONAL_GATES: ReadonlySet<ProfileGate> = Object.freeze(new Set<ProfileGate>(PROFILE_GATES.filter((gate) => !HFS_GATES.has(gate))));
/**
 * Gates that read the output of another, so one cannot be off while the reader runs: Sonar imports the lint report and the coverage of the unit run, the coverage
 * proof and the Codecov upload read the lcov the unit run writes. Switching a gate off needs every gate that reads it off too (HFS_GATE_DECLARATION_INVALID names the pair).
 */
export const GATE_READERS: Readonly<Partial<Record<ProfileGate, readonly ProfileGate[]>>> = Object.freeze({ test: ['coverage', 'codecov', 'sonar'], lint: ['sonar'], coverage: ['codecov'] });
/** The optional gates the policy lets an app switch off (the CLI hands policy/loosening.yaml `optionalGates` in as STARCI_OPTIONAL_GATES); never one outside OPTIONAL_GATES. */
export function optionalGatePolicy(env: NodeJS.ProcessEnv = process.env): ReadonlySet<ProfileGate> {
  return new Set((listEnv(env.STARCI_OPTIONAL_GATES) ?? [...OPTIONAL_GATES]).filter((gate): gate is ProfileGate => OPTIONAL_GATES.has(gate as ProfileGate)));
}
/** The gates a declaration switches off for the whole app, each with its reason, and every problem of the `gates` block. */
export interface GateDeclarations { off: Partial<Record<ProfileGate, string>>; problems: ProfileProblem[] }

/**
 * The `gates` block of a stack declaration (`gates: { lint: { run: off, reason: "..." } }`), read and judged: an id that is no gate, a gate that is never
 * switchable (hfs, secrets, db) or that the policy does not list, a `run` other than `off` and an empty reason are problems, and so
 * is every shape error. The reader keeps nothing when any problem stands, so a refused block switches no gate off (the full gate runs and the finding blocks).
 */
export function readGateDeclarations(doc: unknown, allowed: ReadonlySet<ProfileGate> = optionalGatePolicy()): GateDeclarations {
  const result: GateDeclarations = { off: {}, problems: [] };
  const block = plain(doc) ? doc['gates'] : undefined;
  if (block === undefined) return result;
  const problem = (at: string, message: string): void => { result.problems.push({ at, message }); };
  if (!plain(block)) { problem('gates', 'gates is a mapping of gate id to { run: off, reason }'); return result; }
  const off: Partial<Record<ProfileGate, string>> = {};
  for (const [id, entry] of Object.entries(block)) {
    const at = `gates.${id}`;
    const known = PROFILE_GATES.find((candidate) => candidate === id);
    if (known === undefined) { problem(at, `${id} is not a gate (${PROFILE_GATES.join(', ')}); the gates an app may switch off are ${[...OPTIONAL_GATES].join(', ')}`); continue; }
    if (!OPTIONAL_GATES.has(known)) { problem(at, `${id} is never switched off: it blocks in every app (only ${[...OPTIONAL_GATES].join(', ')} may be switched off, PROJECT-LINT-4)`); continue; }
    if (!allowed.has(known)) { problem(at, `${id} may not be switched off: policy/loosening.yaml optionalGates allows ${[...allowed].join(', ') || 'none'}`); continue; }
    if (!plain(entry) || Object.keys(entry).some((key) => key !== 'run' && key !== 'reason')) { problem(at, `a switched-off gate is { run: off, reason: "<why>" }`); continue; }
    if (entry['run'] !== 'off') { problem(`${at}.run`, `${id} is declared with run ${JSON.stringify(entry['run'] ?? null)}: a gate that runs is not declared, so the only value is off`); continue; }
    const reason = text(entry['reason']);
    if (reason === null) { problem(`${at}.reason`, `${id} is switched off with no reason: say in one short sentence why the app does not run it`); continue; }
    off[known] = reason;
  }
  for (const [gate, readers] of Object.entries(GATE_READERS) as [ProfileGate, readonly ProfileGate[]][]) {
    if (off[gate] === undefined) continue;
    const missing = readers.filter((reader) => off[reader] === undefined);
    if (missing.length > 0) problem(`gates.${gate}`, `${gate} is switched off but ${missing.join(', ')} read${missing.length === 1 ? 's' : ''} its output: switch ${missing.length === 1 ? 'it' : 'them'} off too, or keep ${gate} on`);
  }
  if (result.problems.length === 0) result.off = off;
  return result;
}

/**
 * The gates the stack declaration of the app at `repoRoot` switches off, each with its reason: the one reader every rule that requires a gate's step in a managed
 * file calls, so a gate declared off is not required where the render (`app sync`) leaves it out, and a gate removed without a declaration is still refused.
 */
export function declaredGatesOff(repoRoot: unknown): Partial<Record<ProfileGate, string>> {
  // The one file alone (no folder probe), so a per-file rule that reads it declares exactly that dependency.
  const file = path.join(path.resolve(String(repoRoot ?? '')), STACK_ROOT, DECLARATION);
  if (!isFile(file)) return {};
  const read = readDeclaration(file);
  return read.doc === undefined ? {} : readGateDeclarations(read.doc).off;
}

/**
 * The jobs of the managed ci.yml a declaration idles (its `if` is constant false, and the verdict expects it idle), each with the gates that must all be off:
 * the lint job by lint, the test job by test, the coverage job by coverage and codecov together. The renderer and the bypass check read this one table.
 */
export const IDLE_JOBS: Readonly<Record<string, readonly ProfileGate[]>> = Object.freeze({ lint: ['lint'], test: ['test'], coverage: ['coverage', 'codecov'] });
/** The jobs of IDLE_JOBS whose gates `off` all switches off. */
export const idleJobs = (off: Partial<Record<ProfileGate, string>>): Set<string> => new Set(Object.entries(IDLE_JOBS).filter(([, gates]) => gates.every((gate) => off[gate] !== undefined)).map(([job]) => job));

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
    const pattern = isBranchPattern(branch);
    const covered = [...defaults].filter((name) => matchesBranch(branch, name));
    if (covered.length > 0) problem(at, `${branch} ${pattern ? `matches the default branch ${covered.join(', ')}` : 'is the default branch'}: it always runs the full gate and is never declared or lowered`);
    else if (pattern ? !BRANCH_PATTERN.test(branch) : !BRANCH_NAME.test(branch)) problem(at, pattern
      ? `${branch} is not a branch pattern: a literal first segment, then / and segments where * stands for any characters but / (ui/*)`
      : `${branch} is not a branch name (letters, digits, . _ / -)`);
    else if (pattern && branch.split('/')[0] === 'release') problem(at, `${branch} would cover the release candidates (release/candidate-*), whose run is the release's: a pattern never starts with release/`);
    else if (!allowedBy(policy.branches, branch)) problem(at, `${branch} may not carry a branch profile: policy/loosening.yaml branchProfiles allows ${policy.branches.join(', ') || 'none'}`);
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
