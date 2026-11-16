// concepts-conventions.mts - the presence of an app's concepts (contexts/project/work.md PROJECT-WORK-7), read from the tracked tree and the
// catalog `.starciwork/concepts/README.md` only, never a concept's content, which is held by review:
//   HFS_CONCEPT_CONVENTIONS_MISSING (R433)  every app keeps a `conventions` concept: `.starciwork/concepts/conventions.md` is tracked and the
//                                            catalog has a row that links it (the app's own naming, data model and code conventions, read before
//                                            any change like every concept). The scaffold renders both.
//   HFS_CONCEPT_UNCATALOGUED (R433)          the catalog has one row per concept: every tracked `.starciwork/concepts/<topic>.md` is linked by a
//                                            row, and every row links a tracked concept. A concept no row links is never opened, since a reader
//                                            finds concepts through the catalog; a row whose concept is gone sends the reader nowhere. Reported in
//                                            `--env local`, blocking in `--env prod` (the code is localOnly). Judged only once the catalog is tracked
//                                            (its absence is HFS_CONCEPT_CONVENTIONS_MISSING), and the conventions row is that code's.
import { byCodeUnit } from '../../lib/list.mjs';
import { found, readText } from './read.mjs';
import type { Finding } from './rule-types.mjs';

export const HFS_CONCEPT_CONVENTIONS_MISSING = 'HFS_CONCEPT_CONVENTIONS_MISSING';
export const HFS_CONCEPT_UNCATALOGUED = 'HFS_CONCEPT_UNCATALOGUED';
const DIR = '.starciwork/concepts/';
const CATALOG = `${DIR}README.md`;
const CONCEPT = `${DIR}conventions.md`;
/** A catalog table row whose first cell links the concept: `| [conventions](conventions.md) | ... |`. */
const ROW = /^\|\s*\[[^\]]+\]\(\.?\/?conventions\.md\)\s*\|/mu;
/** The concept a catalog table row's first cell links: `| [orders](orders.md) | ... |` answers `orders.md`. */
const ROW_LINK = /^\|\s*\[[^\]]+\]\((?:\.\/)?([^)\s/#]+\.md)(?:#[^)]*)?\)\s*\|/gmu;

/** R433 findings of an app root's tracked files (`files`, app-relative). */
export function conceptConventionsFindings({ repoRoot, files }: { repoRoot: string; files: readonly string[] }): Finding[] {
  const tracked = new Set(files);
  const findings: Finding[] = [];
  if (!tracked.has(CONCEPT)) findings.push(found(HFS_CONCEPT_CONVENTIONS_MISSING, CONCEPT, `${CONCEPT} is not tracked; every app keeps a conventions concept (its naming, keys, foreign key names, error classes and proof), read before its code: write it under the concept headings of PROJECT-WORK-7`));
  const catalog = tracked.has(CATALOG) ? readText(repoRoot, CATALOG) : null;
  if (catalog === null || !ROW.test(catalog)) findings.push(found(HFS_CONCEPT_CONVENTIONS_MISSING, CATALOG, `${CATALOG} has no catalog row linking conventions.md; add \`| [conventions](conventions.md) | <the folders it governs> | <one line> |\` so every reader opens it first`));
  findings.push(...conceptCatalogFindings(tracked, catalog));
  return findings;
}

/** HFS_CONCEPT_UNCATALOGUED: the tracked concepts no catalog row links, and the rows that link no tracked concept. */
function conceptCatalogFindings(tracked: ReadonlySet<string>, catalog: string | null): Finding[] {
  if (catalog === null) return [];
  const linked = new Set([...catalog.matchAll(ROW_LINK)].map((match) => match[1] as string));
  const concepts = [...tracked].filter((file) => file.startsWith(DIR) && file !== CATALOG && file.endsWith('.md') && !file.slice(DIR.length).includes('/')).sort(byCodeUnit);
  const findings: Finding[] = [];
  for (const file of concepts) {
    const name = file.slice(DIR.length);
    if (!linked.has(name)) findings.push(found(HFS_CONCEPT_UNCATALOGUED, file, `${file} is a concept no row of ${CATALOG} links, so no reader opens it before the code: add \`| [${name.replace(/\.md$/u, '')}](${name}) | <the folders that hold the topic> | <one line> |\` (PROJECT-WORK-7: one row per concept)`, { local: true }));
  }
  for (const name of [...linked].sort(byCodeUnit)) {
    if (name === 'conventions.md' || tracked.has(`${DIR}${name}`)) continue;
    findings.push(found(HFS_CONCEPT_UNCATALOGUED, CATALOG, `${CATALOG} has a row linking ${name}, which is not a tracked concept of ${DIR}: write the concept or delete the row (PROJECT-WORK-7: one row per concept)`, { local: true, concept: name }));
  }
  return findings;
}
