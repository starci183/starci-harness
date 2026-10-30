#!/usr/bin/env node
// release-push-gate.mjs - the body of the runtime repository's pre-push hook (scripts/guards/git-hooks.mjs). Git hands the hook one line
// per ref on stdin: <local ref> <local sha> <remote ref> <remote sha>. Owner ruling push-main-after-scoped-check: the push is light and CI is the critic, so a push of main
// or of a tag passes when the hook runs clean and the secret scan of the pushed range finds nothing:
//   refs/heads/main   not deleted, a fast-forward of the remote main, and the pushed range passes the secret scan (scripts/guards/push-scan.mjs)
//   refs/tags/v*      not deleted and annotated (its message is the release notes); the release definition is judged by `starci release cut`, which makes the tag
//   any other ref     allowed (a lane branch, refs/backup/*, a tag that is not a release tag)
// No release record and no L4 row is asked for. A refusal prints `RIGHTS_PUSH_NOT_RELEASE: <ref> is closed: <why>` per ref and exits 1 (the code keeps its name: the hfs rules and the
// failure-code catalogue cite it; its meaning is "the pre-push gate refused the push"). There is no switch that opens it and no --no-verify.
import { catFile } from '../api/git/cat-file.mjs';
import { isAncestor } from '../api/git/is-ancestor.mjs';
import { isMain } from '../lib/is-main.mjs';
import { invocationDir } from '../lib/roots.mjs';
import { scanRange, type ScanRangeResult } from './push-scan.mjs';
import { hookErrorMessage, readInput, writeHookOutput, type HookInput, type HookOutput } from './hook-io.mjs';

/** One line of git's pre-push stdin. */
interface PushedRef { localRef: string; localSha: string; remoteRef: string; remoteSha: string }
/** The secret scan of a range (a spec injects its own). */
export type RangeScan = (range: { cwd: string; from: string; to: string }) => ScanRangeResult;

export const REFUSAL_CODE = 'RIGHTS_PUSH_NOT_RELEASE';
const ZERO = /^0+$/;
const RELEASE_TAG_REF = /^refs\/tags\/v\d/;
/** git's empty tree: the range base of a first push, so the whole tree is scanned. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const LISTED = 8;

const parseLines = (text: unknown): PushedRef[] => String(text ?? '').split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 4)
  .map((parts) => ({ localRef: parts[0] ?? '', localSha: parts[1] ?? '', remoteRef: parts[2] ?? '', remoteSha: parts[3] ?? '' }));
const refuse = (ref: string, why: string): string => `${REFUSAL_CODE}: ${ref} is closed: ${why}`;

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

function mainRefusal(cwd: string, { remoteRef, localSha, remoteSha }: PushedRef, scan: RangeScan): string | null {
  if (ZERO.test(localSha)) return refuse(remoteRef, 'a push never deletes the runtime main');
  if (!ZERO.test(remoteSha) && !isAncestor(cwd, remoteSha, localSha)) return refuse(remoteRef, 'it is not a fast-forward of the remote main (fetch it first; a force push rewrites main)');
  const scanned = scanRefusal(cwd, { localSha, remoteSha }, scan);
  return scanned ? refuse(remoteRef, scanned) : null;
}

function tagRefusal(cwd: string, { remoteRef, localSha }: PushedRef): string | null {
  if (ZERO.test(localSha)) return refuse(remoteRef, 'a push never deletes a release tag');
  const kind = catFile(['-t', localSha], { cwd, timeout: 60_000 }).stdout?.trim();
  return kind === 'tag' ? null : refuse(remoteRef, 'a release tag is annotated: its message is the release notes');
}

/** The refusal lines for the pushed refs `text` (git's pre-push stdin) of the repository at `cwd`: [] when every ref may move. `scan` is the secret scan (a seam). */
export function pushRefusals({ text, cwd, scan = scanRange }: { text: unknown; cwd: string; scan?: RangeScan }): string[] {
  return parseLines(text).flatMap((ref) => {
    let line: string | null = null;
    if (ref.remoteRef === 'refs/heads/main') line = mainRefusal(cwd, ref, scan);
    else if (RELEASE_TAG_REF.test(ref.remoteRef)) line = tagRefusal(cwd, ref);
    return line ? [line] : [];
  });
}

/** Read a bounded Git ref list; unavailable input cannot authorize a push of main. */
export async function main({ stdin = process.stdin, stderr = process.stderr, cwd = invocationDir() }: { stdin?: HookInput; stderr?: HookOutput; cwd?: string } = {}): Promise<number> {
  try {
    const refusals = pushRefusals({ text: await readInput(stdin), cwd });
    if (refusals.length) await writeHookOutput(stderr, `${refusals.join('\n')}\n`);
    return refusals.length ? 1 : 0;
  } catch (error) {
    await writeHookOutput(stderr, `starci guard: push input error (${hookErrorMessage(error)}); refusing the push\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(await main());
