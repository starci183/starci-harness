// app db restamp: an explicit version map previews file renames and history repairs.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../../engine/yaml.mjs';
import { invocationDir } from '../lib/roots.mjs';
import { migrationStamp } from './rules/database-migrations.mjs';
import { MIGRATIONS_DIR } from './rules/database-constants.mjs';
import { DbVerbError, dbOptions, dbAppRoot, dbSqlFiles, runDbPostgres, repairOp, repairLine, dbFailure } from './db-baseline-verb.mjs';

/** The map value of one old version: a new version, or { file, to, applied } for the colliding-versions case. */
function mapEntry(old, raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { old, file: null, to: String(raw), applied: undefined };
  const known = Object.keys(raw).every((key) => ['file', 'to', 'applied'].includes(key));
  if (!known || (raw.applied !== undefined && typeof raw.applied !== 'boolean') || (raw.file !== undefined && typeof raw.file !== 'string')) throw new DbVerbError('a restamp entry is a new version or { file, to, applied } with a string file and a boolean applied');
  return { old, file: raw.file ?? null, to: raw.to === undefined ? null : String(raw.to), applied: raw.applied };
}

/** The first unoccupied version after `old`, one second at a time. */
function nextFreeVersion(old, occupied) {
  let moment = migrationStamp(old);
  for (;;) {
    moment += 1000;
    const candidate = new Date(moment).toISOString().replace(/\D/g, '').slice(0, 14);
    if (!occupied.has(candidate)) return candidate;
  }
}

/** The active migration that moves: the only file of its version, or the one an entry names among files that share it. */
function sourceOf(entry, active) {
  const sharing = active.filter((file) => file.stamp === entry.old);
  const named = entry.file === null ? sharing : sharing.filter((file) => [file.name, file.name.slice(15), file.name.slice(15).replace(/\.sql$/, '')].includes(entry.file));
  if (named.length === 1 && (sharing.length === 1 || entry.file !== null)) return named[0];
  if (sharing.length > 1) throw new DbVerbError(`version ${entry.old} is shared by ${sharing.map((file) => file.name).join(', ')}; name the file to move: "${entry.old}": { file: <name> }`);
  throw new DbVerbError('each restamp source must identify exactly one active migration; archives never change');
}

/**
 * Whether the history records the file that moves under the shared version `old` (SELECT only: supabase_migrations.schema_migrations keeps the name
 * of the file that ran). No row means nothing ran; a row named for the other file means the one that stays ran. A history that cannot be read is
 * not guessed: the entry has to say `applied`.
 */
function recordedAsApplied(root, source, old, urlEnv, ports) {
  const unreadable = new DbVerbError(`version ${old} is shared by several migrations and the history could not be read; say which one ran with "${old}": { file: <name>, applied: true|false }`);
  let rows;
  try { rows = JSON.parse(runDbPostgres(root, { kind: 'query', sql: `select name from supabase_migrations.schema_migrations where version = '${old}'` }, ports, urlEnv)); } catch { throw unreadable; }
  if (!Array.isArray(rows) || (rows.length > 0 && typeof rows[0]?.name !== 'string')) throw unreadable;
  return rows.length > 0 && rows[0].name === source.name.slice(15).replace(/\.sql$/, '');
}

/** YAML maps use quoted UTC stamps as keys and a new version, or { file, to?, applied? }, as values (or a versions: mapping). */
function restampPlan(root, mapFile, { urlEnv = 'DATABASE_URL', ports = {} } = {}) {
  if (!mapFile) throw new DbVerbError('restamp requires --map <restamp.yaml>');
  let document;
  try { document = parseYaml(fs.readFileSync(path.resolve(root, mapFile), 'utf8')); }
  catch { throw new DbVerbError('restamp map must be readable YAML with unique version keys'); }
  const mapping = document?.versions ?? document;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Object.keys(mapping).length) throw new DbVerbError('restamp map must contain old-to-new version pairs');
  const active = dbSqlFiles(root);
  const occupied = new Set(active.map((entry) => entry.stamp));
  const targets = new Set();
  const steps = Object.entries(mapping).map(([old, raw]) => {
    const entry = mapEntry(old, raw);
    const source = sourceOf(entry, active);
    const shared = active.filter((file) => file.stamp === old).length > 1;
    const next = entry.to ?? nextFreeVersion(old, new Set([...occupied, ...targets]));
    if (![old, next].every((stamp) => /^\d{14}$/.test(stamp) && migrationStamp(stamp) !== null) || old === next) throw new DbVerbError('restamp pairs require distinct valid UTC versions');
    if (occupied.has(next) || targets.has(next)) throw new DbVerbError('restamp targets must be unique unoccupied versions');
    targets.add(next);
    // a version two files share ran for at most one of them: the history says which, unless the entry does
    const applied = entry.applied ?? (shared ? recordedAsApplied(root, source, old, urlEnv, ports) : true);
    return { old, next, source: source.file, target: `${MIGRATIONS_DIR}/${source.name.replace(old, next)}`, applied };
  });
  const moved = new Map(steps.map((step) => [step.source, step.next]));
  const resulting = active.map((entry) => moved.get(entry.file) ?? entry.stamp);
  if (resulting.some((stamp, index) => index > 0 && stamp <= resulting[index - 1])) throw new DbVerbError('the map must cover every version needed to preserve migration order');
  return steps.sort((left, right) => left.old < right.old ? -1 : 1);
}

/** The complete map is validated before any repair or file mutation. */
export function dbRestampMain(argv, { cwd = invocationDir(), stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text), ...ports } = {}) {
  try {
    const opts = dbOptions(argv, ['cwd', 'map', 'apply', 'url-env']);
    const urlEnv = opts['url-env'] ?? 'DATABASE_URL';
    const root = dbAppRoot(cwd, opts);
    const steps = restampPlan(root, opts.map, { urlEnv, ports });
    const repairs = steps.filter((step) => step.applied).flatMap((step) => [repairOp(step.old, 'reverted'), repairOp(step.next, 'applied', step.target.split('/').at(-1).slice(15).replace(/\.sql$/, ''))]);
    stdout(`${opts.apply ? 'apply' : 'preview'} restamp ${steps.length} migrations\n`);
    for (const step of steps) stdout(`${step.source} -> ${step.target}\n`);
    for (const op of repairs) stdout(`${repairLine(op)}\n`);
    if (!opts.apply) return 0;
    // CLI failures never echo credentials and leave the local files intact for an explicit retry.
    for (const op of repairs) runDbPostgres(root, op, ports, urlEnv);
    for (const step of steps) {
      const source = path.join(root, step.source);
      const text = fs.readFileSync(source, 'utf8').replace(/^\s*--\s*starci:restamp\s+\d{14}\s+\d{14}\s*\r?\n/, '');
      fs.writeFileSync(path.join(root, step.target), `-- starci:restamp ${step.old} ${step.next}\n${text}`, { flag: 'wx' });
      fs.unlinkSync(source);
    }
    return 0;
  } catch (error) { return dbFailure('restamp', error, stderr); }
}
