// concepts-conventions.mts - HFS_CONCEPT_CONVENTIONS_MISSING (R433): every app keeps a `conventions` concept (contexts/project/work.md
// PROJECT-WORK-7): `.starciwork/concepts/conventions.md`, the app's own naming, data model and code conventions (its keys and foreign key
// names, its error classes, how it proves behaviour), read before any change like every concept, and a row of the catalog
// `.starciwork/concepts/README.md` that links it. The scaffold renders both; the check reads the tracked tree and the catalog only and
// never the concept's content, which is held by review.
import { found, readText } from './read.mjs';
import type { Finding } from './rule-types.mjs';

export const HFS_CONCEPT_CONVENTIONS_MISSING = 'HFS_CONCEPT_CONVENTIONS_MISSING';
const CATALOG = '.starciwork/concepts/README.md';
const CONCEPT = '.starciwork/concepts/conventions.md';
/** A catalog table row whose first cell links the concept: `| [conventions](conventions.md) | ... |`. */
const ROW = /^\|\s*\[[^\]]+\]\(\.?\/?conventions\.md\)\s*\|/mu;

/** R433 findings of an app root's tracked files (`files`, app-relative). */
export function conceptConventionsFindings({ repoRoot, files }: { repoRoot: string; files: readonly string[] }): Finding[] {
  const tracked = new Set(files);
  const findings: Finding[] = [];
  if (!tracked.has(CONCEPT)) findings.push(found(HFS_CONCEPT_CONVENTIONS_MISSING, CONCEPT, `${CONCEPT} is not tracked; every app keeps a conventions concept (its naming, keys, foreign key names, error classes and proof), read before its code: write it under the concept headings of PROJECT-WORK-7`));
  const catalog = tracked.has(CATALOG) ? readText(repoRoot, CATALOG) : null;
  if (catalog === null || !ROW.test(catalog)) findings.push(found(HFS_CONCEPT_CONVENTIONS_MISSING, CATALOG, `${CATALOG} has no catalog row linking conventions.md; add \`| [conventions](conventions.md) | <the folders it governs> | <one line> |\` so every reader opens it first`));
  return findings;
}
