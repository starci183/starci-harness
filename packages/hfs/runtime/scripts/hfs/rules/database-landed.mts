// database-landed.mts - a migration already on the base branch (byte-identical at the merge-base) is landed: R213 keeps it immutable, so
// its destructive-DDL (R259) and dynamic-DDL findings can no longer be acted on in that file. They are reported as known items, never as
// blockers, while the file stays unchanged; a changed landed file is DB_MIGRATION_SHAPE (R213), and a new file is judged in full. An owner
// ruling (hfs.json db.destructiveRulings, database-migrations.mts) re-proves the objects a landed or new migration destroys.
import { mergeBase } from '../../api/git/merge-base.mjs';
import { sameText } from '../../lib/same-text.mjs';
import { readText } from './read.mjs';
import { defaultGit } from './database-migrations.mjs';
import { DB_DYNAMIC_DDL, DB_MIGRATION_DESTRUCTIVE, isActiveMigration } from './database-constants.mjs';
import type { Parsed } from './rule-types.mjs';

/** What the downgrade reads of a finding: its code, level, file and message. */
type LandableFinding = { code: string; level: string; path?: string | undefined; message?: unknown };

/** The codes a landed migration reports as known items: the ones only a rewrite of the immutable file could clear. */
export const LANDED_KNOWN_CODES: ReadonlySet<string> = new Set([DB_MIGRATION_DESTRUCTIVE, DB_DYNAMIC_DDL]);

/** The merge-base the database rules compare with: of HEAD and `base` when named, else origin/main, else main; null when none resolves. */
export function landedBase(repoRoot: string, base?: string): { ref: string; sha: string } | null {
  for (const ref of base ? [base] : ['origin/main', 'main']) {
    const sha = mergeBase(repoRoot, 'HEAD', ref);
    if (sha) return { ref, sha };
  }
  return null;
}

/**
 * The findings with each error of LANDED_KNOWN_CODES on a migration that is byte-identical at the merge-base turned into a known item
 * (level info, `landed` naming the base). With no merge-base every finding stays as it is.
 */
export function withLandedMigrationsKnown<T extends LandableFinding>(findings: readonly T[], { repoRoot, base, git = defaultGit }: { repoRoot: string; base?: string | undefined; git?: Parsed }): T[] {
  const landable = (finding: T): finding is T & { path: string } => finding.level === 'error' && LANDED_KNOWN_CODES.has(finding.code) && typeof finding.path === 'string' && isActiveMigration(finding.path);
  const files = [...new Set(findings.filter(landable).map((finding) => finding.path))];
  if (!files.length) return [...findings];
  const at = landedBase(repoRoot, base);
  if (at === null) return [...findings];
  const landed = new Set(files.filter((file) => {
    // `./` reads the path from the app root, which is a folder of a larger repository when the app is nested in one.
    const committed = git(['show', `${at.sha}:./${file}`], { cwd: repoRoot });
    return committed.ok === true && sameText(readText(repoRoot, file), String(committed.stdout));
  }));
  return findings.map((finding) => (landable(finding) && landed.has(finding.path)
    ? { ...finding, level: 'info', landed: at.ref, message: `${String(finding.message ?? '')} (known: ${finding.path} is on ${at.ref} unchanged and immutable (R213), so it is reported, not blocking; hfs.json db.destructiveRulings re-proves its objects)` }
    : finding));
}
