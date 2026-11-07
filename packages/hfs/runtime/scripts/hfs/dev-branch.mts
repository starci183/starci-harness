// dev-branch.mts - HFS_DEV_BRANCH_MISSING (error, contexts/project/branches.md PROJECT-BRANCH-1): an app repository must keep `main` and `dev`, so a whole `starci app check`
// of an app that has no `dev` branch, locally or as `origin/dev`, is red in `--env local` and `--env prod` alike. The harness repository (hfs.json kind runtime) is no app and is never asked. A directory that is not
// a git repository has no branches to judge and gets no finding.
import fs from 'node:fs';
import path from 'node:path';
import { revParseQuery } from '../api/git/rev-parse-query.mjs';

export const DEV_BRANCH_MISSING = 'HFS_DEV_BRANCH_MISSING';

const resolves = (repoRoot: string, ref: string): boolean => revParseQuery(['--verify', '-q', ref], { cwd: repoRoot }).status === 0;

/** The error for an app repository with no `dev` branch, or null. */
export function devBranchFinding(repoRoot: string): { code: string; level: 'error'; path: string; message: string } | null {
  let kind: unknown;
  try { kind = (JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8')) as { kind?: unknown }).kind; } catch { return null; }
  if (kind === 'runtime' || !resolves(repoRoot, 'HEAD')) return null;
  if (resolves(repoRoot, 'refs/heads/dev') || resolves(repoRoot, 'refs/remotes/origin/dev')) return null;
  return { code: DEV_BRANCH_MISSING, level: 'error', path: 'hfs.json',
    message: 'this app repository has no dev branch: an app must keep exactly main and dev, dev forked from main and always at or ahead of it, and main moves only to a commit on dev (create it with `git branch dev main` and push it; contexts/project/branches.md PROJECT-BRANCH-1)' };
}
