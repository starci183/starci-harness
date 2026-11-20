// adopt.mts - `starci app db adopt`: takes over a database whose schema another tool built (TypeORM's synchronize, a hosted dashboard) as the
// database the SQL migrations describe, without replaying anything on it. `db migrate` on such a database would find an empty history and run
// db/bootstrap.sql plus the baseline migration over tables that already exist. Adoption instead
//   1. refuses unless the history is empty (no rows in supabase_migrations.schema_migrations) and the database holds tables;
//   2. dumps the live schema (pg_dump --schema-only --no-owner --no-acl, the platform schemas auth, storage, extensions and
//      supabase_migrations left out) and the same dump of a scratch database that received db/bootstrap.sql and the baseline migration
//      (a throwaway container of the app's managed db image, or --image), and REFUSES with a summary of every difference between them,
//      object by object, comparing the dumps as entries (type, schema, name, body), never as text;
//   3. in ONE transaction runs db/bootstrap.sql (idempotent), creates the history table (HISTORY_DDL), applies the privileges the baseline
//      replay holds (GRANT and REVOKE are idempotent) and records the baseline applied (markApplied). The baseline itself never runs.
// `starci app db migrate` then applies every forward migration after the baseline. Dry run by default; --execute applies, armed with
// STARCI_DB_ARMED=1 unless the database is on the loopback. The psql and pg_dump it needs run from the host, else from the pinned postgres image.
import fs from 'node:fs';
import path from 'node:path';
import { refusal, failure } from '../stack/errors.mjs';
import { runVerb } from '../release/index.mjs';
import type { FlagSpec, VerbContext, VerbIo, VerbResult } from '../release/index.mjs';
import { BOOTSTRAP_FILE, buildModel, isLoopback, loadDatabase, requireArmed, resolveTarget } from './migrate.mjs';
import type { DatabaseDecl } from './migrate.mjs';
import { HISTORY_DDL, HISTORY_TABLE, PLATFORM_SCHEMAS, appTableCount, historyVersions, markApplied, pgTool, psqlTransaction, queryRows } from './postgres.mjs';
import type { DbTarget } from './postgres.mjs';
import { buildImage, dumpEntries, entryKey, exec, firstDifference, psqlArgs, replay, scratchTarget, startScratch } from '../runtime/scripts/hfs/db-squash.mjs';
import type { DumpEntry } from '../runtime/scripts/hfs/db-squash.mjs';
import { DbVerbError } from '../runtime/scripts/hfs/db-errors.mjs';
import { DB_BASE_IMAGE, DB_DOCKERFILE } from './image.mjs';
import { PREVIOUS_MAJOR_IMAGES } from '../stack/db-upgrade-core.mjs';
import { SEED_RECEIPTS } from '../stack/seeds.mjs';

const DUMP_FLAGS = ['--schema-only', '--no-owner', ...PLATFORM_SCHEMAS.flatMap((schema) => ['-N', schema])];
const DIFF_LIMIT = 40;

/**
 * The tables the harness owns in an app database, never part of the schema an adopted database is compared with: the seed receipts (stack/seeds.mts SEED_RECEIPTS, the one name) and the
 * migration history (supabase_migrations, a schema the compare leaves out already).
 */
const HARNESS_TABLES: readonly string[] = [SEED_RECEIPTS];

/** The entries of a dump that belong to the tables `tables` (`public.x` or `x`): the table, its constraints and defaults, its indexes, the sequences it owns and their ownership. */
export function belongingTo(entries: readonly DumpEntry[], tables: readonly string[]): Set<DumpEntry> {
  const wanted = tables.map((table) => (table.includes('.') ? table : `public.${table}`));
  const bare = new Set(wanted.map((table) => table.split('.')[1] as string));
  const inSchema = (entry: DumpEntry, name: string): boolean => wanted.includes(`${entry.schema}.${name}`);
  const owned = new Set<string>();
  for (const entry of entries) {
    const match = entry.type === 'SEQUENCE OWNED BY' ? /OWNED BY ([\w".]+)\.[\w"]+;?\s*$/u.exec(entry.body) : null;
    const table = match?.[1]?.replaceAll('"', '').split('.').at(-1);
    if (table !== undefined && bare.has(table) && wanted.some((name) => name.endsWith(`.${table}`))) owned.add(`${entry.schema}.${entry.name}`);
  }
  const mentions = (entry: DumpEntry): boolean => [...bare].some((table) => new RegExp(`(?:ON|ONLY|TABLE) (?:${entry.schema}\\.)?"?${table}"?(?:[\\s(;]|$)`, 'u').test(entry.body));
  const picked = new Set<DumpEntry>();
  for (const entry of entries) {
    const head = entry.name.split(' ')[0] as string;
    if ((entry.type === 'TABLE' && inSchema(entry, entry.name)) || (entry.name.includes(' ') && bare.has(head) && wanted.includes(`${entry.schema}.${head}`) && !/^(?:TABLE|SEQUENCE|VIEW) /u.test(entry.name))
      || (entry.type === 'INDEX' && mentions(entry)) || ((entry.type === 'SEQUENCE' || entry.type === 'SEQUENCE OWNED BY') && owned.has(`${entry.schema}.${entry.name}`))
      || (['ACL', 'COMMENT'].includes(entry.type) && /^TABLE /u.test(entry.name) && inSchema(entry, entry.name.slice(6)))) picked.add(entry);
  }
  return picked;
}

/** The refusals of the verb are DbVerbErrors from the shared squash helpers; they surface as the verb's own refusal code. */
const asRefusal = (error: unknown): never => { throw error instanceof DbVerbError ? refusal('DB_ADOPT_SCRATCH', error.message) : error; };

/** The differences between the live schema's entries and the replay's, as `-` (live only), `+` (baseline only) and `~` (changed) lines. */
export function schemaDiff(live: readonly DumpEntry[], baseline: readonly DumpEntry[]): string[] {
  const [have, want] = [new Map(live.map((entry): [string, string] => [entryKey(entry), entry.body])), new Map(baseline.map((entry): [string, string] => [entryKey(entry), entry.body]))];
  const lines: string[] = [];
  for (const [key, body] of want) {
    if (!have.has(key)) lines.push(`+ ${key.replaceAll('|', ' ')}: in the baseline, not in the database`);
    else if (have.get(key) !== body) lines.push(`~ ${key.replaceAll('|', ' ')}: ${firstDifference(have.get(key) as string, body).replace('source', 'database').replace('replay', 'baseline')}`);
  }
  for (const key of have.keys()) if (!want.has(key)) lines.push(`- ${key.replaceAll('|', ' ')}: in the database, not in the baseline`);
  return lines;
}

/** Entries of a dump that are privileges: what the baseline replay grants, applied to the live database at adoption. */
const privilegeSql = (entries: readonly DumpEntry[]): string[] => entries.filter((entry) => entry.type === 'ACL' || entry.type === 'DEFAULT ACL').map((entry) => entry.body.replace(/^--.*$/gmu, '').trim()).filter(Boolean);

/** The major version of the PostgreSQL server of a database (`server_version_num` 170011 is 17). */
const majorOf = (ctx: VerbContext, target: DbTarget): number => Math.floor(Number(queryRows(ctx, target, "select current_setting('server_version_num')::int as num", { withhold: true })[0]?.num ?? 0) / 10000);

/** The pinned postgres image of a major (contexts/stack/pins.yaml: the managed db image's base and the previous majors db-upgrade uses), or null when none is pinned. */
export function pinnedImageOf(major: number): string | null {
  if (Number(/^postgres:(\d+)/u.exec(DB_BASE_IMAGE)?.[1]) === major) return DB_BASE_IMAGE;
  return PREVIOUS_MAJOR_IMAGES[String(major)]?.debian ?? null;
}

/**
 * A constraint or index definition with the spellings two server majors disagree on taken out: the casts of literals (`'a'::text`), an `= ANY (ARRAY[...])` list (written `IN (...)`), redundant
 * parentheses and layout. Only the fallback of the compare uses it (no image of the live major is pinned); the literals themselves stay, so a changed allowed value is still a difference.
 */
export function normaliseDefinition(text: string): string {
  return text
    .replaceAll(/::(?:character varying|text|bpchar|name|integer|bigint|smallint|numeric|boolean|uuid|timestamp(?: with(?:out)? time zone)?)(?:\[\])?/gu, '')
    .replaceAll(/[()]/gu, '')
    .replaceAll(/=\s*ANY\s+ARRAY\s*\[([^\]]*)\]/gu, 'IN $1')
    .replaceAll(/\s*,\s*/gu, ',')
    .replaceAll(/\s+/gu, ' ').trim();
}

interface Compared { live: DumpEntry[]; baseline: DumpEntry[]; privileges: string[]; how: string; left: string[]; notes: string[] }

/** The live schema and the replay of bootstrap + baseline, both as entries, the replay on a server of the live major (see the notes it returns). */
function compared(ctx: VerbContext, target: DbTarget, root: string, files: Array<[string, string]>, image: string | undefined, leftOut: ReadonlyArray<{ label: string; tables: readonly string[] }>): Compared {
  const liveAll = dumpEntries(pgTool(ctx, target, 'pg_dump', [...DUMP_FLAGS, '--dbname', target.url], { withhold: true }).stdout).entries;
  const left: string[] = [];
  const notes: string[] = [];
  const without = (entries: DumpEntry[], report: boolean): DumpEntry[] => {
    let kept = entries;
    for (const group of leftOut) {
      if (group.tables.length === 0) continue;
      const out = belongingTo(kept, group.tables);
      if (report && out.size > 0) left.push(`${group.label}: ${group.tables.join(', ')} (${out.size} object(s))`);
      kept = kept.filter((entry) => !out.has(entry));
    }
    return kept;
  };
  const live = without(liveAll, true);
  const liveMajor = majorOf(ctx, target);
  /** Replays on `ref` and reads both dumps; null when the server there is not the live major (`needMajor`) or the replay cannot run (`soft`). */
  const attempt = (ref: string, label: string, { needMajor, soft }: { needMajor: boolean; soft: boolean }): Compared | null => {
    let scratch: ReturnType<typeof startScratch>;
    try { scratch = startScratch(ref); } catch (error) { if (soft) return null; return asRefusal(error); }
    try {
      const admin = scratchTarget(scratch, 'postgres');
      const major = Math.floor(Number(exec(admin, 'psql', [...psqlArgs(admin), '-Atc', 'show server_version_num']).trim()) / 10000);
      if (needMajor && major !== liveMajor) return null;
      let database: ReturnType<typeof replay>;
      try { database = replay(scratch, files); } catch (error) { if (soft) return null; return asRefusal(error); }
      let baseline = without(dumpEntries(exec(database, 'pg_dump', [...DUMP_FLAGS, '-d', database.url])).entries, false);
      const withAcl = dumpEntries(exec(database, 'pg_dump', ['--schema-only', '--no-owner', ...PLATFORM_SCHEMAS.flatMap((schema) => ['-N', schema]), '-d', database.url])).entries;
      let liveSide = live;
      if (major !== liveMajor) {
        // No server of the live major to replay on: the definitions are rendered by two majors, so both sides are compared through the textual normalisation.
        notes.push(`compare        textual normalisation of constraint and index definitions: the replay ran on PostgreSQL ${major} and the database on ${liveMajor}, and no image of ${liveMajor} could replay bootstrap + baseline`);
        const flat = (entries: DumpEntry[]): DumpEntry[] => entries.map((entry) => ({ ...entry, body: normaliseDefinition(entry.body) }));
        baseline = flat(baseline);
        liveSide = flat(live);
      } else notes.push(`compare        definitions rendered by the same server major (PostgreSQL ${liveMajor}) on both sides`);
      return { live: liveSide, baseline, privileges: privilegeSql(withAcl), left, notes, how: `${label} (PostgreSQL ${major})` };
    } catch (error) { return asRefusal(error); } finally { scratch.stop(); }
  };
  let app: string;
  try { app = image ?? buildImage(root); } catch (error) { return asRefusal(error); }
  const appLabel = image === undefined ? `a scratch container of the image ${DB_DOCKERFILE} builds` : `a scratch container of ${image}`;
  const same = attempt(app, appLabel, { needMajor: true, soft: false });
  if (same !== null) return same;
  // The app's db image runs another major than the database (a restore from an older server): the definitions would be rendered twice, so replay on the pinned image of the live major.
  const pinned = pinnedImageOf(liveMajor);
  if (pinned !== null) {
    const there = attempt(pinned, `a scratch container of the pinned ${pinned.split('@')[0] as string}`, { needMajor: true, soft: true });
    if (there !== null) return there;
    notes.push(`compare        the pinned PostgreSQL ${liveMajor} image could not replay bootstrap + baseline (an extension only the app's db image holds?)`);
  } else notes.push(`compare        no image of PostgreSQL ${liveMajor} is pinned`);
  const fallback = attempt(app, appLabel, { needMajor: false, soft: false });
  return fallback as Compared;
}

/**
 * `starci app db adopt`. options: { execute, urlEnv, image, target }. The dry run proves the schema equals the baseline's and prints the plan,
 * writing nothing; --execute adopts. Every refusal names its code (DB_ADOPT_*) and the next step.
 */
export async function adoptDatabase(ctx: VerbContext, decl: DatabaseDecl, options: { execute?: boolean; urlEnv?: string | undefined; image?: string | undefined; ifPending?: boolean; target?: DbTarget } = {}): Promise<VerbResult> {
  if (decl.baseline === null) throw refusal('DB_ADOPT_NO_BASELINE', 'adopt marks the baseline migration applied: declare it as database.baseline in .starcistacks/application-stacks.yaml');
  if (decl.standard !== null) throw refusal('DB_ADOPT_STANDARD', 'adopt takes a database with one baseline; database.standard (a second baseline) is migrated, not adopted');
  const model = buildModel(ctx.cwd, decl);
  const baselineFile = model.baselineFile as string;
  const target = resolveTarget(ctx, options);
  const remote = historyVersions(ctx, target);
  const stamp = model.baseline as string;
  if (remote.size > 0 && options.ifPending === true) return { ok: true, lines: [`target         ${target.how}`, `${HISTORY_TABLE} already holds ${remote.size} version(s): nothing to adopt.`], data: { adopted: false, executed: false, baseline: stamp, pending: false } };
  if (remote.has(stamp)) return { ok: true, lines: [`target         ${target.how}`, `the baseline ${stamp} is already recorded in ${HISTORY_TABLE}. Nothing to do; starci app db migrate applies the forward migrations.`], data: { adopted: false, executed: false, baseline: stamp } };
  if (remote.size > 0) throw refusal('DB_ADOPT_HISTORY_NOT_EMPTY', `${HISTORY_TABLE} already holds ${remote.size} version(s) and none is the baseline ${stamp}: that database is migrated, not adopted (starci app db migrate, or db restamp)`);
  const count = appTableCount(ctx, target);
  if (count === 0 && options.ifPending === true) return { ok: true, lines: [`target         ${target.how}`, 'the database holds no tables: nothing to adopt (starci app db migrate builds it).'], data: { adopted: false, executed: false, baseline: stamp, pending: false } };
  if (count === 0) throw refusal('DB_ADOPT_EMPTY', 'the database holds no tables: there is nothing to adopt; starci app db migrate --execute builds an empty database from bootstrap and the baseline');
  const bootstrap = path.join(ctx.cwd, BOOTSTRAP_FILE);
  const hasBootstrap = fs.existsSync(bootstrap);
  const files: Array<[string, string]> = [
    ...(hasBootstrap ? [[BOOTSTRAP_FILE, fs.readFileSync(bootstrap, 'utf8')] as [string, string]] : []),
    [`${decl.migrationsDir}/${baselineFile}`, fs.readFileSync(path.join(ctx.cwd, decl.migrationsDir, baselineFile), 'utf8')],
  ];
  const { live, baseline, privileges, how, left, notes } = compared(ctx, target, ctx.cwd, files, options.image, [{ label: 'left as is, harness-owned', tables: HARNESS_TABLES }, { label: 'left as is, legacy history', tables: decl.adopt.legacyHistory }]);
  const diff = schemaDiff(live, baseline);
  if (diff.length > 0) {
    const shown = diff.slice(0, DIFF_LIMIT);
    throw refusal('DB_ADOPT_SCHEMA_DIFFERS', `the database schema is not the baseline ${stamp} (${diff.length} difference(s); - only in the database, + only in the baseline, ~ changed):\n${shown.map((line) => `  ${line}`).join('\n')}${diff.length > DIFF_LIMIT ? `\n  ... ${diff.length - DIFF_LIMIT} more` : ''}\nnothing applied.`);
  }
  const lines = [
    `target         ${target.how}`,
    `proof          schema of the database (${live.length} object(s), platform schemas ${PLATFORM_SCHEMAS.join(', ')} left out) equals bootstrap + baseline replayed on ${how}`,
    ...notes,
    ...left.map((line) => `leave          ${line}`),
    `bootstrap      ${hasBootstrap ? `${BOOTSTRAP_FILE} runs (idempotent)` : 'none in this app'}`,
    `privileges     ${privileges.length} grant statement(s) of the baseline replay`,
    `history        ${HISTORY_TABLE} is created and the baseline ${stamp} (${baselineFile.slice(15, -'.sql'.length)}) recorded applied; the baseline is not run`,
  ];
  const data = { adopted: false, executed: false, baseline: stamp, objects: live.length, privileges: privileges.length };
  if (options.execute !== true) return { ok: true, lines: [...lines, 'dry run: read-only. Nothing applied; --execute adopts.'], data };
  if (!isLoopback(target.url)) requireArmed(ctx);
  psqlTransaction(ctx, target, [
    ...(hasBootstrap ? [{ file: bootstrap }] : []),
    { sql: HISTORY_DDL },
    ...privileges.map((sql) => ({ sql })),
    { sql: markApplied(stamp, baselineFile.slice(15, -'.sql'.length)) },
  ]);
  const after = historyVersions(ctx, target);
  if (!after.has(stamp)) throw failure('DB_ADOPT_FINAL_MISMATCH', `the history does not record the baseline ${stamp} after adoption`);
  return { ok: true, lines: [...lines, `adopted: the history holds ${[...after].join(', ')}. starci app db migrate applies the forward migrations after it.`], data: { ...data, adopted: true, executed: true } };
}

/** The flags of `starci app db adopt`; the parser refuses every other. */
export const SPEC: FlagSpec = { boolean: ['--execute', '--json', '--if-pending'], value: ['--db-url-env', '--image'] };

/** Entry of the verb: `starci app db adopt [--execute] [--if-pending] [--db-url-env <NAME>] [--image <ref>] [--json]`. */
export function dbAdoptMain(argv: string[], io: VerbIo = {}): Promise<number> {
  return runVerb({
    label: 'starci app db adopt', name: 'db adopt', code: 'DB_USAGE', io, argv, spec: SPEC,
    run: async (ctx, flags, positional) => {
      if (positional.length) throw refusal('DB_USAGE', 'adopt takes flags only');
      return adoptDatabase(ctx, loadDatabase(ctx.cwd), { execute: flags.execute === true, urlEnv: flags['db-url-env'] as string | undefined, image: flags.image as string | undefined, ifPending: flags['if-pending'] === true });
    },
  });
}
