import fs from 'node:fs';
import path from 'node:path';
import { declaredEnvironments } from '../runtime/scripts/hfs/rules/seeds.mjs';
import { SEED_FILE } from '../runtime/scripts/hfs/rules/database-constants.mjs';
import { addSeedEntries, SEED_FOLDERS, SEEDS_KEEP, SEEDS_MANIFEST, SEEDS_SCHEMA, seedLevelDir } from '../runtime/scripts/hfs/stack-seeds-config.mjs';
import type { SeedEntryInput } from '../runtime/scripts/hfs/stack-seeds-config.mjs';
import { filesUnder, relativePosix, sideFolders } from './source-tree.mjs';

/** One seed file the migration moves into a level's `sql/` and declares in its manifest; `drop` when the target already holds its bytes. */
export interface SeedsLayoutMove { from: string; to: string; entry: string; action: 'move' | 'drop' }
/** One case left for a person. */
export interface SeedsLayoutFinding { file: string; code: string; reason: string }
/** The report of a migration (`starci app codemod seeds-layout`). */
export interface SeedsLayoutReport {
  schema: string; root: string; write: boolean; environments: string[]; moves: SeedsLayoutMove[]; created: string[]; findings: SeedsLayoutFinding[];
}

/** The lite SQL seed of manifest 3.17 (slot app.db.seed): its rows are every environment's, so it moves to the shared level. */
const LEGACY_DB_SEED = 'db/seed.sql';
/** The id and target a moved SQL seed is declared with: the primary database, applied again whenever its content changes. */
const SQL_TARGET = 'primary';
/** How a source names an old seed home: the lite seed path, or the seeds folder of an environment read without its sql/ folder. */
const LEGACY_REFERENCE = /db\/seed\.sql|"\.starcistacks",\s*[A-Za-z_$][\w$]*,\s*"seeds"\)/u;
const SOURCE = /\.(?:[cm]?[jt]s|json)$/u;

const isFile = (target: string): boolean => fs.statSync(target, { throwIfNoEntry: false })?.isFile() === true;
const isFolder = (target: string): boolean => fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() === true;
const entryId = (name: string): string => name.replace(/\.sql$/u, '').toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-').replaceAll(/^-+|-+$/gu, '');

/** The loose seed files of each declared environment's level (directly in `<env>/seeds/`) and the lite `db/seed.sql`, with where each goes. */
function legacySeeds(root: string, environments: string[], findings: SeedsLayoutFinding[]): Array<{ env: string | null; from: string; name: string }> {
  const loose = environments.flatMap((env) => {
    const level = path.join(root, seedLevelDir(env));
    if (!isFolder(level)) return [];
    return fs.readdirSync(level, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name !== SEEDS_MANIFEST && entry.name !== SEEDS_KEEP).flatMap((entry) => {
      const from = `${seedLevelDir(env)}/${entry.name}`;
      if (entry.name.endsWith('.sql')) return [{ env, from, name: entry.name }];
      findings.push({ file: from, code: 'SEEDS_LAYOUT_NOT_SQL', reason: `only a SQL seed moves by itself; put it under ${seedLevelDir(env)}/data/ or files/ and declare its target (and, for data, its schema) in ${SEEDS_MANIFEST}` });
      return [];
    });
  });
  return [...loose, ...(isFile(path.join(root, LEGACY_DB_SEED)) ? [{ env: null, from: LEGACY_DB_SEED, name: path.posix.basename(SEED_FILE) }] : [])];
}

/** The sources of the app's sides that still name an old seed home (a seed runner the app owns): each is left for a person. */
function referenceFindings(root: string): SeedsLayoutFinding[] {
  return sideFolders(root).flatMap((side) => filesUnder(side, SOURCE)).flatMap((file) => {
    const line = fs.readFileSync(file, 'utf8').split('\n').findIndex((text) => LEGACY_REFERENCE.test(text));
    return line === -1 ? [] : [{ file: `${relativePosix(root, file)}:${line + 1}`, code: 'SEEDS_LAYOUT_REFERENCE', reason: 'names the old seed home; read the sql/ folder of .starcistacks/seeds/ and then of .starcistacks/<env>/seeds/ (the scaffold\'s seed runner is the model)' }];
  });
}

/** The placeholders and empty manifests a level lacks: `seeds.yaml`, and a `.gitkeep` in each kind folder that holds nothing. */
function levelSkeleton(root: string, env: string | null, landed: ReadonlySet<string>): string[] {
  const dir = seedLevelDir(env);
  const manifest = isFile(path.join(root, dir, SEEDS_MANIFEST)) || landed.has(`${dir}/${SEEDS_MANIFEST}`) ? [] : [`${dir}/${SEEDS_MANIFEST}`];
  const keeps = SEED_FOLDERS.map((kind) => `${dir}/${kind}`).filter((folder) => !landed.has(folder) && (!isFolder(path.join(root, folder)) || fs.readdirSync(path.join(root, folder)).length === 0));
  return [...manifest, ...keeps.map((folder) => `${folder}/${SEEDS_KEEP}`)];
}

/**
 * Migrate an app's seed data into the seed levels of `.starcistacks/` (ruling seed-levels, contexts/project/stacks.md PROJECT-STACKS-12):
 * `db/seed.sql` moves to the shared level's `sql/reference.sql` and each loose SQL file of `<env>/seeds/` to that level's `sql/`, each
 * declared in its level's `seeds.yaml` (target the primary database, mode upsert); every level gets its manifest and a `.gitkeep` for each
 * kind folder that holds nothing. A target with the same bytes drops the old copy; other bytes, a loose seed that is no SQL and a source that
 * still names an old home are left for a person. A second run finds nothing to do.
 */
export function migrateSeedsLayout({ root, write = false }: { root: string; write?: boolean }): SeedsLayoutReport {
  const environments = [...(declaredEnvironments(root)?.keys() ?? [])];
  const report: SeedsLayoutReport = { schema: 'starci/seeds-layout-report@1', root, write, environments, moves: [], created: [], findings: [] };
  const landed = new Set<string>();
  const entries = new Map<string | null, SeedEntryInput[]>();
  for (const { env, from, name } of legacySeeds(root, environments, report.findings)) {
    const to = `${seedLevelDir(env)}/sql/${name}`;
    const source = path.join(root, from);
    const target = path.join(root, to);
    if (isFile(target) && !fs.readFileSync(target).equals(fs.readFileSync(source))) {
      report.findings.push({ file: from, code: 'SEEDS_LAYOUT_CONFLICT', reason: `${to} already holds other data; merge the two by hand and delete ${from}` });
      continue;
    }
    const id = entryId(name);
    report.moves.push({ from, to, entry: id, action: isFile(target) ? 'drop' : 'move' });
    entries.set(env, [...(entries.get(env) ?? []), { id, kind: 'sql', path: `sql/${name}`, target: SQL_TARGET, mode: 'upsert' }]);
    landed.add(`${seedLevelDir(env)}/sql`).add(`${seedLevelDir(env)}/${SEEDS_MANIFEST}`);
    if (!write) continue;
    if (isFile(target)) fs.rmSync(source);
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(source, target);
    }
  }
  for (const [env, list] of entries) addSeedEntries(root, env, list, write);
  for (const env of [null, ...environments]) report.created.push(...levelSkeleton(root, env, landed));
  if (write) {
    for (const file of report.created) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), file.endsWith(SEEDS_MANIFEST) ? `schema: ${SEEDS_SCHEMA}\nentries: []\n` : '');
    }
  }
  report.findings.push(...referenceFindings(root));
  return report;
}

const cell = (value: unknown): string => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Render the migration and what is left for a person as Markdown; JSON consumers read the same report object. */
export function seedsLayoutMarkdown(report: SeedsLayoutReport): string {
  const done = report.write ? 'moved' : 'would be moved';
  const out = ['# seeds-layout', '', `${report.moves.length} seed file(s) ${done}, ${report.created.length} level file(s) ${report.write ? 'created' : 'would be created'}, ${report.findings.length} left for a person.`, ''];
  if (report.findings.length) {
    out.push('## Left for a person', '', '| file | code | reason |', '|---|---|---|');
    for (const finding of report.findings) out.push(`| ${cell(finding.file)} | ${finding.code} | ${cell(finding.reason)} |`);
    out.push('');
  }
  if (report.moves.length) {
    out.push('## Moved', '', '| from | to | entry | action |', '|---|---|---|---|');
    for (const item of report.moves) out.push(`| ${cell(item.from)} | ${cell(item.to)} | ${item.entry} | ${item.action} |`);
    out.push('');
  }
  if (report.created.length) out.push('## Created', '', ...report.created.map((file) => `- ${file}`), '');
  return `${out.join('\n')}\n`;
}
