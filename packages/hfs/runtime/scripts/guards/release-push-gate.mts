#!/usr/bin/env node
// release-push-gate.mts - the body of the runtime repository's pre-push hook (scripts/guards/git-hooks.mjs). Git hands the hook one line
// per ref on stdin: <local ref> <local sha> <remote ref> <remote sha>. The push is light and CI is the critic, so a push of main
// or of a tag passes when the hook runs clean and the secret scan of the pushed range finds nothing:
//   refs/heads/main   not deleted, a fast-forward of the remote main, the pushed range passes the secret scan (scripts/guards/push-scan.mts), the pushed commit is on `dev`
//                     (local and origin: BRANCH_MAIN_NOT_ON_DEV) and is the checked-out HEAD, the commit the `app check` of the hook judges under the full gate
//                     (BRANCH_MAIN_NOT_CHECKED_OUT); the hook runs that check with STARCI_JUDGED_BRANCH=main, so a dev checkout never lends main its branch profile
//   refs/heads/dev    not deleted, and `main` (local, origin and a main pushed with it) is an ancestor of the pushed dev (BRANCH_DEV_NOT_ON_MAIN)
//   refs/tags/v*      not deleted and annotated (its message is the release notes); the release definition is judged by `starci release cut`, which makes the tag
//   any other ref     allowed (a lane or feature branch, refs/backup/*, a tag that is not a release tag)
// No release record and no L4 row is asked for. A refusal prints `RIGHTS_PUSH_NOT_RELEASE: <ref> is closed: <why>` per ref and exits 1 (the code keeps its name: the hfs rules and the
// failure-code catalogue cite it; its meaning is "the pre-push gate refused the push"). There is no switch that opens it and no --no-verify.
import { catFile } from '../api/git/cat-file.mjs';
import { isAncestor } from '../api/git/is-ancestor.mjs';
import { revParseQuery } from '../api/git/rev-parse-query.mjs';
import { isMain } from '../lib/is-main.mjs';
import { invocationDir } from '../lib/roots.mjs';
import { scanRange, type ScanRangeResult } from './push-scan.mjs';
import { hookErrorMessage, readInput, writeHookOutput, type HookInput, type HookOutput } from './hook-io.mjs';

/** One line of git's pre-push stdin. */
interface PushedRef { localRef: string; localSha: string; remoteRef: string; remoteSha: string }
/** The secret scan of a range (a spec injects its own). */
export type RangeScan = (range: { cwd: string; from: string; to: string }) => ScanRangeResult;

export const REFUSAL_CODE = 'RIGHTS_PUSH_NOT_RELEASE';
/** contexts/project/branches.md PROJECT-BRANCH-1: main moves only to a commit on dev, dev always contains main, and a main push is judged on the commit it moves. */
export const MAIN_NOT_ON_DEV = 'BRANCH_MAIN_NOT_ON_DEV';
export const DEV_NOT_ON_MAIN = 'BRANCH_DEV_NOT_ON_MAIN';
export const MAIN_NOT_CHECKED_OUT = 'BRANCH_MAIN_NOT_CHECKED_OUT';
const MAIN_REF = 'refs/heads/main';
const DEV_REF = 'refs/heads/dev';
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ZERO = /^0+$/;
const RELEASE_TAG_REF = /^refs\/tags\/v\d/;
/** git's empty tree: the range base of a first push, so the whole tree is scanned. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const LISTED = 8;

const parseLines = (text: unknown): PushedRef[] => String(text ?? '').split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 4)
  .map((parts) => ({ localRef: parts[0] ?? '', localSha: parts[1] ?? '', remoteRef: parts[2] ?? '', remoteSha: parts[3] ?? '' }));
const refuse = (ref: string, why: string, code: string = REFUSAL_CODE): string => `${code}: ${ref} is closed: ${why}`;
/** The commit `ref` names in the repository at `cwd`, or null when it does not resolve. */
const commitOf = (cwd: string, ref: string): string | null => {
  const run = revParseQuery(['--verify', '-q', `${ref}^{commit}`], { cwd });
  const sha = run.status === 0 ? String(run.stdout ?? '').trim() : '';
  return sha === '' ? null : sha;
};

/** What one push carries besides the ref being judged: the remote it goes to and every pushed ref's local commit. */
interface PushContext { remote: string; pushed: Map<string, string> }

/** The branch `main` is promoted from: the pushed commit is on every dev tip that exists (a dev pushed with it, else the local dev and the remote-tracking dev) and is the checked-out HEAD. */
function mainBranchRefusal(cwd: string, { remoteRef, localSha, remoteSha }: PushedRef, context: PushContext): string | null {
  const pushedDev = context.pushed.get(DEV_REF);
  const tips: (readonly [string, string | null])[] = pushedDev === undefined
    ? [['dev', commitOf(cwd, DEV_REF)], [`${context.remote}/dev`, commitOf(cwd, `refs/remotes/${context.remote}/dev`)]]
    : [['the dev pushed with it', ZERO.test(pushedDev) ? null : pushedDev], ['dev', commitOf(cwd, DEV_REF)]];
  const present = tips.filter((tip): tip is readonly [string, string] => tip[1] !== null);
  if (present.length === 0 && !ZERO.test(remoteSha)) return refuse(remoteRef, 'there is no dev branch: main moves only to a commit on dev (create dev from main and push it first)', MAIN_NOT_ON_DEV);
  const off = present.filter(([, tip]) => !isAncestor(cwd, localSha, tip)).map(([name]) => name);
  if (off.length > 0) return refuse(remoteRef, `the commit is not on ${off.join(' and ')}: main moves only to a commit on dev, locally and on the remote (merge the work into dev and push dev first, then fast-forward main to dev)`, MAIN_NOT_ON_DEV);
  if (commitOf(cwd, 'HEAD') !== localSha) return refuse(remoteRef, 'it is not the checked-out commit: the app check of this hook judges the checked-out tree under the full gate, so check out the commit you push', MAIN_NOT_CHECKED_OUT);
  return null;
}

/** dev keeps main as an ancestor: never deleted, and it contains the local main, the remote-tracking main and a main pushed with it. */
function devRefusal(cwd: string, { remoteRef, localSha }: PushedRef, context: PushContext): string | null {
  if (ZERO.test(localSha)) return refuse(remoteRef, 'a push never deletes dev, the working branch', DEV_NOT_ON_MAIN);
  const pushedMain = context.pushed.get(MAIN_REF);
  const mains: (readonly [string, string | null])[] = [['main', commitOf(cwd, MAIN_REF)], [`${context.remote}/main`, commitOf(cwd, `refs/remotes/${context.remote}/main`)], ['the main pushed with it', pushedMain === undefined || ZERO.test(pushedMain) ? null : pushedMain]];
  const behind = mains.filter((tip): tip is readonly [string, string] => tip[1] !== null).filter(([, tip]) => !isAncestor(cwd, tip, localSha)).map(([name]) => name);
  return behind.length === 0 ? null : refuse(remoteRef, `dev does not contain ${behind.join(' and ')}: dev is always at or ahead of main and the two never diverge (merge main into dev, or fast-forward dev to it, then push)`, DEV_NOT_ON_MAIN);
}

/** The secret-scan refusal of the pushed range, or null when it is clean. A finding names the file, line and pattern, never the value. */
function scanRefusal(cwd: string, { localSha, remoteSha }: Pick<PushedRef, 'localSha' | 'remoteSha'>, scan: RangeScan): string | null {
  const result = scan({ cwd, from: ZERO.test(remoteSha) ? EMPTY_TREE : remoteSha, to: localSha });
  if (result.ok) return null;
  if (result.error) return `the secret scan of the pushed range could not run (${result.error}), so it cannot be called clean`;
  const where = (f: { file: string | null; line: number | null; pattern: string }): string => [f.line ? `${f.file}:${f.line}` : f.file, f.pattern].join(' ');
  const found = result.findings.slice(0, LISTED).map(where).join('; ');
  const more = result.findings.length > LISTED ? '; ...' : '';
  return `the secret scan found ${result.findings.length} candidate(s) in the pushed range: ${found}${more} (remove or encrypt them, then commit again)`;
}

function mainRefusal(cwd: string, pushedRef: PushedRef, scan: RangeScan, context: PushContext): string | null {
  const { remoteRef, localSha, remoteSha } = pushedRef;
  if (ZERO.test(localSha)) return refuse(remoteRef, 'a push never deletes the runtime main');
  if (!ZERO.test(remoteSha) && !isAncestor(cwd, remoteSha, localSha)) return refuse(remoteRef, 'it is not a fast-forward of the remote main (fetch it first; a force push rewrites main)');
  const scanned = scanRefusal(cwd, { localSha, remoteSha }, scan);
  return scanned ? refuse(remoteRef, scanned) : mainBranchRefusal(cwd, pushedRef, context);
}

function tagRefusal(cwd: string, { remoteRef, localSha }: PushedRef): string | null {
  if (ZERO.test(localSha)) return refuse(remoteRef, 'a push never deletes a release tag');
  const kind = catFile(['-t', localSha], { cwd, timeout: 60_000 }).stdout?.trim();
  return kind === 'tag' ? null : refuse(remoteRef, 'a release tag is annotated: its message is the release notes');
}

/** The refusal lines for the pushed refs `text` (git's pre-push stdin) of the repository at `cwd`: [] when every ref may move. `scan` is the secret scan (a seam). */
export function pushRefusals({ text, cwd, scan = scanRange, remote }: { text: unknown; cwd: string; scan?: RangeScan; remote?: string | undefined }): string[] {
  const refs = parseLines(text);
  const context: PushContext = { remote: remote !== undefined && REMOTE_NAME.test(remote) ? remote : 'origin', pushed: new Map(refs.map((ref) => [ref.remoteRef, ref.localSha])) };
  return refs.flatMap((ref) => {
    let line: string | null = null;
    if (ref.remoteRef === MAIN_REF) line = mainRefusal(cwd, ref, scan, context);
    else if (ref.remoteRef === DEV_REF) line = devRefusal(cwd, ref, context);
    else if (RELEASE_TAG_REF.test(ref.remoteRef)) line = tagRefusal(cwd, ref);
    return line ? [line] : [];
  });
}

/** Read a bounded Git ref list; unavailable input cannot authorize a push of main. */
export async function main({ stdin = process.stdin, stderr = process.stderr, cwd = invocationDir() }: { stdin?: HookInput; stderr?: HookOutput; cwd?: string } = {}): Promise<number> {
  try {
    const refusals = pushRefusals({ text: await readInput(stdin), cwd, remote: process.env.STARCI_PUSH_REMOTE });
    if (refusals.length) await writeHookOutput(stderr, `${refusals.join('\n')}\n`);
    return refusals.length ? 1 : 0;
  } catch (error) {
    await writeHookOutput(stderr, `starci guard: push input error (${hookErrorMessage(error)}); refusing the push\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(await main());
