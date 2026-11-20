// The database rules of an app's db/ tree (design 4.2, L02-L09). SQL migrations are parsed with libpg-query through
// database-sql.mts; Git history and generated-type checks are split into bounded sibling modules.
import { found, readJson, readText } from './read.mjs';
import { baselineResetOf } from './database-reset.mjs';
import { contractReleaseFindings, defaultGit, migrationShapeFindings } from './database-migrations.mjs';
import { attachDoStatements, migrationSetPolicyFindings, sqlAnalysis } from './database-sql.mjs';
import { migrationSetDefinerFindings } from './database-plpgsql.mjs';
import { databaseAccessFindings } from './database-access.mjs';
import { migrationSetKeyFindings } from './database-keys.mjs';
import { BOOTSTRAP_FILE, DB_DIR, DB_MIGRATION_SHAPE, isActiveMigration, LITE_DB_MIGRATION, MIGRATIONS_ARCHIVE_DIR, MIGRATIONS_DIR } from './database-constants.mjs';
import { isSeedFile } from './seeds.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import { eachInOrder } from '../../lib/in-order.mjs';

export { migrationStamp } from './database-migrations.mjs';
export {
  DB_APP_ROLE, DB_FORCE_RLS_DEFAULT, DB_POLICY_TAUTOLOGY, DB_VIEW_UNSAFE, DB_STORAGE_PREFIX,
} from './database-access.mjs';
export const DB_DEFINER_REVOKE = 'DB_DEFINER_REVOKE';
export {
  DB_DEFINER_SAFE,
  DB_DYNAMIC_DDL,
  DB_FOREIGN_KEY_INDEX,
  DB_FOREIGN_KEY_NAME,
  DB_MIGRATION_SHAPE,
  DB_PRIMARY_KEY_SHAPE,
  DB_POLICY_SHAPE,
  DB_RLS_REQUIRED,
  DB_STORAGE_POLICY,
  LITE_DB_MIGRATION,
} from './database-constants.mjs';
import { DB_RLS_REQUIRED as RLS_REQUIRED_CODE } from './database-constants.mjs';
import type { Finding, Parsed } from './rule-types.mjs';

/** The schemas the app's tables live in; no schema is exposed to a browser, which reaches data only through the back end. */
const APP_SCHEMAS = new Set(['public']);

/**
 * LITE_DB_MIGRATION: an app's schema lives only under db/: no supabase/ tree and no SQL file outside db/ but its seed data (the seed
 * levels of .starcistacks/, judged by R375), and every SQL file under db/ is a migration, the archive, the bootstrap or nothing.
 */
export function liteDbPathFindings(files: string[]) {
  const findings = [];
  for (const file of files) {
    if (file === 'supabase' || file.startsWith('supabase/')) {
      findings.push(found(LITE_DB_MIGRATION, file, `${file} is a Supabase project file; an app keeps its schema in ${MIGRATIONS_DIR}/<ts14>_<kebab>.sql (move the migrations, delete supabase/)`, {}));
      continue;
    }
    if (!file.endsWith('.sql') || isSeedFile(file)) continue;
    if (!file.startsWith(`${DB_DIR}/`)) findings.push(found(LITE_DB_MIGRATION, file, `${file} is SQL outside ${DB_DIR}/; a schema change is one ${MIGRATIONS_DIR}/<ts14>_<kebab>.sql`, {}));
    else if (!isActiveMigration(file) && !file.startsWith(`${MIGRATIONS_ARCHIVE_DIR}/`) && file !== BOOTSTRAP_FILE) findings.push(found(LITE_DB_MIGRATION, file, `${file} is SQL under ${DB_DIR}/ that is no migration, archive or bootstrap; seed data is an entry of a seed level, .starcistacks/seeds/sql/ or .starcistacks/<env>/seeds/sql/ (starci app codemod seeds-layout moves it)`, {}));
  }
  return findings;
}

/** The schema and name a DROP TABLE statement names, one per dropped table. */
const droppedTableNames = (statement: Parsed): string[] => (statement.type === 'DropStmt' && statement.node?.removeType === 'OBJECT_TABLE'
  ? (statement.node.objects ?? []).map((object: Parsed) => (object?.List?.items ?? []).map((item: Parsed) => item?.String?.sval).filter((name: unknown): name is string => typeof name === 'string')).filter((parts: string[]) => parts.length > 0)
    .map((parts: string[]) => (parts.length > 1 ? `${parts.at(-2)}.${parts.at(-1)}` : `${statement.defaultSchema ?? 'public'}.${parts[0]}`))
  : []);

/**
 * DB_RLS_REQUIRED over the ordered set. A table created without `enable row level security` (or, for a declared definer-owned table, `force row level security`) in its own migration is
 * judged by what the later migrations do: a baseline in the shape a database has today carries no RLS (adopt would see policies the live database lacks) and a later migration adds it, so the
 * table that ends with RLS enabled (and forced, where declared), or is dropped, is no finding. A table that ends without it keeps its finding.
 */
function cumulativeRlsFindings(findings: Finding[], analyses: Parsed[]): Finding[] {
  return findings.filter((finding) => {
    const missing = (finding as { missing?: string }).missing;
    const table = (finding as { table?: string }).table;
    if (finding.code !== RLS_REQUIRED_CODE || (missing !== 'enable' && missing !== 'force') || table === undefined) return true;
    const at = analyses.findIndex((analysis) => analysis.file === finding.path);
    if (at < 0) return true;
    const [schema, name] = table.split('.') as [string, string];
    return !analyses.slice(at + 1).some(({ facts }) => (missing === 'enable' ? facts?.enables : facts?.forces)?.some((event: Parsed) => event.schema === schema && event.name === name)
      || (facts?.statements ?? []).some((statement: Parsed) => droppedTableNames(statement).includes(table)));
  });
}

async function migrationAnalyses({ repoRoot, migrations, exposed, forceRls, findings }: { repoRoot: string; migrations: Parsed; exposed: Parsed; forceRls: Parsed; findings: Finding[] }) {
  const analyses: Parsed[] = [];
  await eachInOrder(migrations, async (file: string) => {
    const text = readText(repoRoot, file);
    if (text === null) {
      findings.push(found(DB_MIGRATION_SHAPE, file, `${file} is not a readable SQL file`, {}));
      return;
    }
    const analysis = await sqlAnalysis({ file, text, exposed, forceRls });
    findings.push(...analysis.findings);
    if (analysis.facts) analyses.push({ file, facts: analysis.facts });
  });
  return analyses;
}

/**
 * Judge the db/ tree of one app. Git is injected for deterministic specs; this function starts no
 * database and no Docker process.
 */
export async function checkDatabase({ repoRoot, files, base, git, db }: { repoRoot: string; files: string[]; base?: Parsed; git?: Parsed; db?: Parsed }) {
  const findings: Finding[] = [];
  const declaration = readJson(repoRoot, 'hfs.json');
  const migrations = files.filter(isActiveMigration).sort(byCodeUnit);
  const declared = db === undefined ? declaration?.db : db;
  const archived = files.filter((file: string) => file.startsWith(`${MIGRATIONS_ARCHIVE_DIR}/`));
  findings.push(...liteDbPathFindings(files));
  const forceRls = new Set((declared?.forceRls ?? []).map((name: string) => (name.includes('.') ? name : `public.${name}`)));
  findings.push(...await migrationShapeFindings({ repoRoot, migrations, archived, git: git ?? defaultGit, base, reset: baselineResetOf(declared) }));
  findings.push(...await contractReleaseFindings({ repoRoot, migrations, git: git ?? defaultGit }));

  const analyses = await migrationAnalyses({ repoRoot, migrations, exposed: APP_SCHEMAS, forceRls, findings });
  for (const analysis of analyses) await attachDoStatements(analysis.facts);
  const rls = cumulativeRlsFindings(findings.splice(0), analyses);
  findings.push(...rls);
  findings.push(
    ...migrationSetPolicyFindings(analyses),
    ...migrationSetDefinerFindings(analyses, APP_SCHEMAS),
    ...await databaseAccessFindings({ analyses, exposed: APP_SCHEMAS, db: declared }),
    ...migrationSetKeyFindings(analyses, APP_SCHEMAS, declared),
  );
  return findings;
}
