// branch-profile.mts - the branch profile a run of `starci app check` is under: the branch it judges, chosen automatically, and the profile the stack
// declaration states for it (`branches` of .starcistacks/application-stacks.yaml, read by scripts/lib/stack-declaration.mts readBranchProfiles).
//   CI         a pull request (GITHUB_BASE_REF) into the default branch runs the full gate; any other pull request is judged as its source branch
//              (GITHUB_HEAD_REF); a push is judged as its branch (GITHUB_REF refs/heads/<branch>, a tag is no branch)
//   hook       STARCI_JUDGED_BRANCH, which the managed pre-push hook sets to `main` for a push of main or a release tag: that push is judged as main, whatever branch is checked out
//   elsewhere  the checked-out branch (`git rev-parse --abbrev-ref HEAD`; a detached HEAD is no branch)
// A branch takes its own entry, else every pattern entry that matches it (`ui/*` for ui/3), merged to the stricter mode per gate (profileFor).
// The default branch is the declaration's (ci.github.defaultBranch, else main), or CI's STARCI_DEFAULT_BRANCH when it is set. No branch, the default branch, a branch with no profile and a declaration with any HFS_BRANCH_PROFILE_INVALID problem run the full gate: every gate blocks.
import { runGit } from '../api/git/lib.mjs';
import { findStackDeclaration, profileFor, profilePolicy, readBranchProfiles, type GateMode, type ProfileGate } from '../lib/stack-declaration.mjs';

/**
 * The branch profile a run is under: the branch, how it was chosen, the profile's name when one applies (else null: the full gate), the declaration key that
 * gave it (the branch itself, or the pattern such as `ui/*` that covers it) and each gate's mode.
 */
export interface ActiveProfile { branch: string | null; source: string; profile: string | null; modes: Record<ProfileGate, GateMode> }

const FULL_GATE: Record<ProfileGate, GateMode> = Object.freeze({ hfs: 'blocking', format: 'blocking', db: 'blocking', secrets: 'blocking', wiring: 'blocking', types: 'blocking', lint: 'blocking', test: 'blocking', sonar: 'blocking', codecov: 'blocking' });
const set = (value: string | undefined): string | null => (value !== undefined && value.trim() !== '' ? value.trim() : null);

/** The branch a run judges and how it was chosen: a pull request into `defaultBranch` is judged as the default branch. */
export function judgedBranch(repoRoot: string, env: NodeJS.ProcessEnv, defaultBranch: string): { branch: string | null; source: string } {
  const pushed = set(env.STARCI_JUDGED_BRANCH);
  if (pushed !== null) return { branch: pushed, source: 'the branch the push moves (STARCI_JUDGED_BRANCH, set by the managed pre-push hook)' };
  const base = set(env.GITHUB_BASE_REF);
  if (base !== null) {
    if (base === defaultBranch) return { branch: defaultBranch, source: `a pull request into ${defaultBranch} (GITHUB_BASE_REF)` };
    return { branch: set(env.GITHUB_HEAD_REF), source: `a pull request from its source branch (GITHUB_HEAD_REF, into ${base})` };
  }
  const ref = set(env.GITHUB_REF);
  if (ref !== null) return ref.startsWith('refs/heads/') ? { branch: ref.slice('refs/heads/'.length), source: 'the pushed branch (GITHUB_REF)' } : { branch: null, source: `${ref} is not a branch (GITHUB_REF)` };
  const head = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { dir: repoRoot });
  const name = !head.error && head.status === 0 ? String(head.stdout ?? '').trim() : '';
  return name !== '' && name !== 'HEAD' ? { branch: name, source: 'the checked-out branch (git rev-parse --abbrev-ref HEAD)' } : { branch: null, source: 'no checked-out branch' };
}

/** The branch profile of a run at `repoRoot` under `env`. */
export function activeProfile(repoRoot: string, env: NodeJS.ProcessEnv = process.env): ActiveProfile {
  const declaration = findStackDeclaration(repoRoot);
  const read = readBranchProfiles(declaration.doc, profilePolicy(env));
  const defaultBranch = set(env.STARCI_DEFAULT_BRANCH) ?? read.defaultBranch;
  const { branch, source } = judgedBranch(repoRoot, env, defaultBranch);
  // The default branch never takes a profile, whatever a pattern would match (the reader refuses such a pattern too; STARCI_DEFAULT_BRANCH may name another branch).
  const declared = branch === null || branch === defaultBranch ? null : profileFor(read.profiles, branch);
  if (branch === null || declared === null || read.problems.length > 0) return { branch, source, profile: null, modes: { ...FULL_GATE } };
  return { branch, source, profile: declared.key, modes: { ...FULL_GATE, ...declared.gates } };
}

const RANK: Record<GateMode, number> = { off: 0, report: 1, blocking: 2 };
/** The stronger of two modes: a family two gates share (sonar and codecov select the one sonar family) runs as the stricter of them. */
export const stronger = (a: GateMode, b: GateMode): GateMode => (RANK[a] >= RANK[b] ? a : b);

/** The mode of each check family under a profile: every family is its gate, the sonar family the stronger of sonar and codecov. */
export function familyModes(profile: ActiveProfile): Record<string, GateMode> {
  const { codecov, sonar, ...rest } = profile.modes;
  return { ...rest, sonar: stronger(sonar, codecov) };
}

/** How a profile is named in a message: `branch profile dev`, or `branch profile ui/* (pattern)` when a pattern covers the branch. */
export const profileLabel = (profile: ActiveProfile): string => (profile.profile === null ? 'no branch profile' : profile.profile === profile.branch ? `branch profile ${profile.profile}` : `branch profile ${profile.profile} (a pattern covering ${profile.branch ?? 'the branch'})`);

/** The one-line notice of every gate a profile does not keep blocking: `<gate>: report on branch <b> (branch profile ...)`. */
export function profileNotices(profile: ActiveProfile): string[] {
  if (profile.profile === null) return [];
  return (Object.entries(profile.modes) as [ProfileGate, GateMode][]).filter(([, mode]) => mode !== 'blocking')
    .map(([gate, mode]) => `${gate}: ${mode === 'off' ? 'off, not run' : 'report, its findings are listed but never count'} on branch ${profile.branch ?? (profile.profile as string)} (${profileLabel(profile)} of .starcistacks/application-stacks.yaml; ${profile.source})`);
}
