// The database rules of a lite app's db/ tree (design 4.2, L02-L09). SQL migrations are parsed with libpg-query through
// database-sql.mjs; Git history and generated-type checks are split into bounded sibling modules.
import { found, readJson, readText } from './read.mjs';
import { defaultGit, migrationShapeFindings } from './database-migrations.mjs';
import { migrationSetPolicyFindings, sqlAnalysis } from './database-sql.mjs';
import { migrationSetDefinerFindings } from './database-plpgsql.mjs';
import { databaseAccessFindings } from './database-access.mjs';
import { DB_DIR, DB_MIGRATION_SHAPE, isActiveMigration, LITE_DB_MIGRATION, MIGRATIONS_ARCHIVE_DIR, MIGRATIONS_DIR } from './database-constants.mjs';
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
  DB_MIGRATION_SHAPE,
  DB_POLICY_SHAPE,
  DB_RLS_REQUIRED,
  DB_STORAGE_POLICY,
  LITE_DB_MIGRATION,
} from './database-constants.mjs';

/** The schemas the app's tables live in; no schema is exposed to a browser, which reaches data only through the back end. */
const APP_SCHEMAS = new Set(['public']);

/** A .starcistacks seed is the one SQL file a lite app keeps outside db/. */
const STACK_SEED = /^\.starcistacks\/[^/]+\/seeds\/.+\.sql$/;

/**
 * LITE_DB_MIGRATION: a lite app's schema lives only under db/: no supabase/ tree and no SQL file outside db/ (but a
 * .starcistacks seed), and every SQL file under db/ is a migration, the archive, the seed or nothing.
 */
export function liteDbPathFindings(files) {
  const findings = [];
  for (const file of files) {
    if (file === 'supabase' || file.startsWith('supabase/')) {
      findings.push(found(LITE_DB_MIGRATION, file, `${file} is a Supabase project file; a lite app keeps its schema in ${MIGRATIONS_DIR}/<ts14>_<kebab>.sql (move the migrations, delete supabase/)`, {}));
      continue;
    }
    if (!file.endsWith('.sql') || STACK_SEED.test(file)) continue;
    if (!file.startsWith(`${DB_DIR}/`)) findings.push(found(LITE_DB_MIGRATION, file, `${file} is SQL outside ${DB_DIR}/; a schema change is one ${MIGRATIONS_DIR}/<ts14>_<kebab>.sql`, {}));
  }
  return findings;
}

async function migrationAnalyses({ repoRoot, migrations, exposed, forceRls, findings }) {
  const analyses = [];
  await eachInOrder(migrations, async (file) => {
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
 * Judge the db/ tree of one lite app. Git is injected for deterministic specs; this function starts no
 * database and no Docker process. A full app keeps its TypeORM migrations under be/ and is judged here only for a stray db/ tree.
 */
export async function checkDatabase({ repoRoot, files, base, git, edition, db } = {}) {
  const findings = [];
  const declaration = readJson(repoRoot, 'hfs.json');
  const lite = (edition ?? declaration?.edition) === 'lite';
  const migrations = files.filter(isActiveMigration).sort(byCodeUnit);
  if (!lite && !migrations.length) return findings;
  const declared = db === undefined ? declaration?.db : db;
  const archived = files.filter((file) => file.startsWith(`${MIGRATIONS_ARCHIVE_DIR}/`));
  if (lite) findings.push(...liteDbPathFindings(files));
  const forceRls = new Set((declared?.forceRls ?? []).map((name) => (name.includes('.') ? name : `public.${name}`)));
  findings.push(...await migrationShapeFindings({ repoRoot, migrations, archived, git: git ?? defaultGit, base }));

  const analyses = await migrationAnalyses({ repoRoot, migrations, exposed: APP_SCHEMAS, forceRls, findings });
  findings.push(
    ...migrationSetPolicyFindings(analyses),
    ...migrationSetDefinerFindings(analyses, APP_SCHEMAS),
    ...await databaseAccessFindings({ analyses, exposed: APP_SCHEMAS, db: declared }),
  );
  return findings;
}
