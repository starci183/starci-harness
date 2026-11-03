// seeds.mjs - the seed step (contexts/project/stacks.md PROJECT-STACKS-12): after the migrations, the entries of the shared level and then of
// the environment's level, each in apply order, on the database the migrations ran on and under the role they ran as. The harness owns
// the receipts: one row per entry in `public.starci_seed_receipts` of that database, created by this step (never an app migration), holding
// the entry's content hash and, for a document entry with secret references, the member names and a digest of their values. A `once` entry
// with a receipt never runs again; an `upsert` entry runs again when its hash (or a referenced secret) changed; a rerun with nothing changed
// writes nothing. A `sql` entry runs in one transaction with its receipt. A `data` or `test-account` entry validates its documents against the
// app's schema, opens their secret references in memory with the environment's age identity (the sops seam) and hands the resolved documents
// to the app command it names on stdin, never in argv, a file or a log; its receipt is written once the command succeeded. A `files` entry
// is validated only: the harness has no object-storage client, so its upload stays the app's. Without `execute` the step reads the
// receipts and prints what would apply.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { literal, psqlTransaction, queryRows } from '../db/postgres.mjs';
import type { DbTarget } from '../db/postgres.mjs';
import { validateAgainstSchema } from '../runtime/scripts/lib/json-schema.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { envelopeOf } from '../runtime/scripts/hfs/secret-document.mjs';
import { entryDigest, entryFiles, isDocumentEntry, readSeedLevel, resolveSecrets, secretReferences, seedDocuments, seedMemberFile } from '../runtime/scripts/hfs/stack-seeds-config.mjs';
import type { SeedEntry, SeedLevel } from '../runtime/scripts/hfs/stack-seeds-config.mjs';
import type { DeployConfig } from './config.mjs';
import { lines as splitLines, tool } from './context.mjs';
import type { RunResult, StackContext } from './context.mjs';
import { DB_WAIT_SECONDS } from './db-phases.mjs';
import type { DeployDatabase, FloorDeps } from './db-phases.mjs';
import { failure, refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';

/** The receipts table of the seed step, in the app's database. */
export const SEED_RECEIPTS = 'public.starci_seed_receipts';
const RECEIPTS_DDL = `create table if not exists ${SEED_RECEIPTS} (scope text not null, id text not null, hash text not null, secrets text not null default '', env text not null, applied_at timestamptz not null default now(), primary key (scope, id))`;
/** The scope of the shared level's receipts; an environment's level uses its name. */
const SHARED_SCOPE = 'shared';
/** What a secret's value reads as in a dry run, which opens no member. */
const SEALED = '[sealed]';

/** What the seed step reaches: the app root, the environment, its database (the migrations' target) and how an app command runs. */
export interface SeedStepInput {
  ctx: StackContext;
  repoRoot: string;
  env: string;
  target: DbTarget;
  execute: boolean;
  /** Runs a document entry's app command with the resolved documents on stdin. */
  command: (argv: readonly string[], input: string) => RunResult;
}

/** One receipt row. */
interface Receipt { scope: string; id: string; hash: string; secrets: string }
/** One entry as the step sees it: its level, scope and content hash. */
interface Planned { level: SeedLevel; scope: string; entry: SeedEntry; hash: string }

const sha = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

/** The two levels of `env` in apply order; a manifest problem refuses the step before anything runs. */
function levelsOf(repoRoot: string, env: string): SeedLevel[] {
  const shared = readSeedLevel(repoRoot, null);
  const own = readSeedLevel(repoRoot, env, new Set(shared.entries.map((entry) => entry.id)));
  for (const level of [shared, own]) {
    const [problem] = level.problems;
    if (problem) throw refusal('STACK_SEED_MANIFEST', `${level.dir}/seeds.yaml ${problem.at}: ${problem.message}; run starci app check`);
  }
  return [shared, own];
}

/** The receipts the database holds; none before the first armed run created the table. */
function receiptsOf(input: SeedStepInput): Receipt[] {
  const [present] = queryRows(input.ctx, input.target, `select to_regclass(${literal(SEED_RECEIPTS)}) is not null as present`);
  if (present?.present !== true) return [];
  return queryRows(input.ctx, input.target, `select scope, id, hash, secrets from ${SEED_RECEIPTS}`).map((row) => ({ scope: String(row.scope), id: String(row.id), hash: String(row.hash), secrets: String(row.secrets) }));
}

/** The statement that records an entry's receipt. */
const receiptSql = (item: Planned, env: string, secrets: string): string =>
  `insert into ${SEED_RECEIPTS} (scope, id, hash, secrets, env) values (${literal(item.scope)}, ${literal(item.entry.id)}, ${literal(item.hash)}, ${literal(secrets)}, ${literal(env)}) ` +
  'on conflict (scope, id) do update set hash = excluded.hash, secrets = excluded.secrets, env = excluded.env, applied_at = now()';

/** The documents of a document entry with its secret references resolved by `open`, refused when one fails the app's schema. */
function resolvedDocuments(input: SeedStepInput, item: Planned, open: (member: string) => Record<string, string>): Array<{ path: string; document: unknown }> {
  const schemaText = fs.readFileSync(path.join(input.repoRoot, String(item.entry.schema)), 'utf8');
  const schema: unknown = item.entry.schema?.endsWith('.json') ? JSON.parse(schemaText) : parseYaml(schemaText);
  return seedDocuments(path.join(input.repoRoot, item.level.dir), item.entry).map((document) => {
    if (document.error !== undefined) throw refusal('STACK_SEED_DATA_INVALID', `${item.scope}/${item.entry.id}: ${document.path} does not parse`);
    const resolved = resolveSecrets(document.doc, open);
    const [error] = validateAgainstSchema(resolved, schema);
    if (error !== undefined) throw refusal('STACK_SEED_DATA_INVALID', `${item.scope}/${item.entry.id}: ${document.path} does not validate against ${String(item.entry.schema)}: ${error.replace(/:.*$/u, '')}`);
    return { path: document.path, document: resolved };
  });
}

/** The members a document entry references, in first-use order. */
const membersOf = (input: SeedStepInput, item: Planned): string[] =>
  [...new Set(seedDocuments(path.join(input.repoRoot, item.level.dir), item.entry).flatMap((document) => secretReferences(document.doc)))];

/** Opens one sealed member of the environment in memory (the sops seam and its age identity) and answers its map. */
function openMember(input: SeedStepInput, member: string): Record<string, string> {
  const file = memberPath(input, member);
  return input.ctx.sops.decrypt(file, envelopeOf(fs.readFileSync(file, 'utf8')).format);
}

/** The sealed file of a member of the environment; refused when the environment does not seal it. */
function memberPath(input: SeedStepInput, member: string): string {
  const file = path.join(input.repoRoot, seedMemberFile(input.env, member));
  if (!fs.existsSync(file)) throw refusal('STACK_SEED_SECRET_MISSING', `${seedMemberFile(input.env, member)} is not sealed; seal it with starci app secret set --env ${input.env}`);
  return file;
}

/** What a member reads as in a dry run: its key names from the envelope, each a sealed placeholder; no value is opened. */
function sealedMember(input: SeedStepInput, member: string): Record<string, string> {
  return Object.fromEntries(envelopeOf(fs.readFileSync(memberPath(input, member), 'utf8')).keys.map((key) => [key, SEALED]));
}

/** The receipt text of the opened members: each name with a digest of its values, never a value. */
const secretsReceipt = (opened: ReadonlyMap<string, Record<string, string>>): string =>
  [...opened].map(([member, values]) => `${member}:${sha(JSON.stringify(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : Number(a > b))))).slice(0, 16)}`).join(',');

/** Applies one document entry: the app command with the resolved documents on stdin, then its receipt; answers the receipt's secrets. */
function applyDocuments(input: SeedStepInput, item: Planned, receipt: Receipt | undefined): string | null {
  const opened = new Map<string, Record<string, string>>();
  const open = (member: string): Record<string, string> => {
    const known = opened.get(member);
    if (known) return known;
    const values = openMember(input, member);
    opened.set(member, values);
    return values;
  };
  const documents = resolvedDocuments(input, item, open);
  const secrets = secretsReceipt(opened);
  if (receipt?.hash === item.hash && receipt.secrets === secrets) return null;
  const run = input.command(item.entry.target as string[], `${JSON.stringify({ env: input.env, scope: item.scope, entry: item.entry.id, kind: item.entry.kind, documents })}\n`);
  if (run.error || run.status !== 0) throw failure('STACK_SEED_COMMAND', `${item.scope}/${item.entry.id}: ${(item.entry.target as string[]).join(' ')} ${run.error ? 'could not run' : `exited ${String(run.status)}`}; its output is withheld (it held the opened secrets)`);
  psqlTransaction(input.ctx, input.target, [{ sql: receiptSql(item, input.env, secrets) }], { withhold: true, code: 'STACK_SEED_RECEIPT' });
  return secrets;
}

/** The line of an entry the step leaves as it is, or null when it applies. */
function keptLine(item: Planned, receipt: Receipt | undefined): string | null {
  const name = `seed ${item.scope}/${item.entry.id}`;
  if (item.entry.kind === 'files') return `${name}: validated, not uploaded (files: the harness has no object-storage client; the app uploads them to ${String(item.entry.target)})`;
  if (receipt && item.entry.mode === 'once') return `${name}: kept (once, applied before)`;
  if (receipt?.hash === item.hash && item.entry.kind === 'sql') return `${name}: unchanged (upsert)`;
  return null;
}

/** The seed step of `env`: plans it, or with `execute` applies it. Returns { ok, lines, data: { applied, kept } }. */
export function seedStep(input: SeedStepInput): ActionResult {
  const planned: Planned[] = levelsOf(input.repoRoot, input.env).flatMap((level) => level.entries.map((entry) => ({
    level, scope: level.env ?? SHARED_SCOPE, entry, hash: entryDigest(path.join(input.repoRoot, level.dir), entry),
  })));
  if (planned.length === 0) return { ok: true, lines: ['seed: no entry in .starcistacks/seeds or the level of the environment'], data: { applied: [], entries: 0 } };
  const receipts = receiptsOf(input);
  const lines: string[] = [];
  const applied: string[] = [];
  if (input.execute) psqlTransaction(input.ctx, input.target, [{ sql: RECEIPTS_DDL }], { code: 'STACK_SEED_RECEIPT' });
  for (const item of planned) {
    const receipt = receipts.find((row) => row.scope === item.scope && row.id === item.entry.id);
    const kept = keptLine(item, receipt);
    const name = `${item.scope}/${item.entry.id}`;
    if (kept !== null) { lines.push(kept); continue; }
    if (!input.execute) {
      const members = isDocumentEntry(item.entry) ? membersOf(input, item) : [];
      if (isDocumentEntry(item.entry)) resolvedDocuments(input, item, (member) => sealedMember(input, member));
      const unchanged = receipt?.hash === item.hash;
      lines.push(`plan seed ${name}: ${unchanged ? 'apply when a referenced secret changed' : 'apply'} (${item.entry.kind}, ${item.entry.mode}${members.length ? `, secrets ${members.join(', ')}` : ''})`);
      continue;
    }
    if (item.entry.kind === 'sql') {
      const files = entryFiles(path.join(input.repoRoot, item.level.dir), item.entry).map((file) => ({ file: path.join(input.repoRoot, item.level.dir, file) }));
      psqlTransaction(input.ctx, input.target, [...files, { sql: receiptSql(item, input.env, '') }], { code: 'STACK_SEED_SQL' });
      lines.push(`seed ${name}: applied (sql, ${item.entry.mode}, ${files.length} file${files.length === 1 ? '' : 's'})`);
      applied.push(name);
      continue;
    }
    const secrets = applyDocuments(input, item, receipt);
    if (secrets === null) { lines.push(`seed ${name}: unchanged (${item.entry.mode})`); continue; }
    lines.push(`seed ${name}: applied (${item.entry.kind}, ${item.entry.mode}${secrets ? `, secrets ${secrets.split(',').map((part) => part.split(':')[0]).join(', ')}` : ''})`);
    applied.push(name);
  }
  if (planned.length === 0) lines.push('seed: no entry in .starcistacks/seeds or the environment\'s level');
  return { ok: true, lines, data: { applied, entries: planned.length } };
}

/** The running container of a service of the stack on this daemon, or undefined. */
function serviceContainer(ctx: StackContext, config: Pick<DeployConfig, 'stack'>, service: string): string | undefined {
  const found = tool(ctx, 'docker', ['ps', '-q', '--filter', `label=com.docker.swarm.service.name=${config.stack}_${service}`, '--filter', 'status=running']);
  return splitLines(found.stdout)[0];
}

/** True when either seed level of the environment declares an entry. */
export function hasSeedEntries(repoRoot: string, env: string): boolean {
  return readSeedLevel(repoRoot, null).entries.length > 0 || readSeedLevel(repoRoot, env).entries.length > 0;
}

/** What a deploy's dry run says of the seed step: every entry of the two levels, each applied unless its receipt holds. */
export function seedPlanLine(repoRoot: string, env: string): string {
  const entries = levelsOf(repoRoot, env).flatMap((level) => level.entries.map((entry) => `${level.env ?? SHARED_SCOPE}/${entry.id} (${entry.kind}, ${entry.mode})`));
  return `seed after convergence, each entry unless its receipt in ${SEED_RECEIPTS} holds: ${entries.join(', ')}`;
}

/**
 * The seed step of a deploy (PROJECT-STACKS-6), after convergence so a document entry's app command is the new release's: in the database
 * container under the credentials it holds (the role the migrations ran as), each app command inside a running task of the jobs service
 * (`deploy.jobs.service`), the documents on its stdin.
 */
export async function seedDeployed(ctx: StackContext, config: DeployConfig, database: Pick<DeployDatabase, 'service'>, f: Pick<FloorDeps, 'dbContainer' | 'containerTarget'>): Promise<ActionResult> {
  const container = await f.dbContainer(ctx, config, { service: database.service, seconds: DB_WAIT_SECONDS });
  if (!container) return { ok: false, lines: [`FAIL  seed  no running container of ${config.stack}_${database.service} within ${DB_WAIT_SECONDS}s`] };
  const command = (argv: readonly string[], input: string): RunResult => {
    const service = config.jobs?.service;
    if (service === undefined) throw refusal('STACK_SEED_NO_SERVICE', 'a data entry runs its app command in the jobs service; declare deploy.jobs of the environment');
    const task = serviceContainer(ctx, config, service);
    if (!task) return { status: null, stdout: '', stderr: '', error: new Error(`no running container of ${config.stack}_${service}`) };
    return tool(ctx, 'docker', ['exec', '-i', task, ...argv], { input });
  };
  return seedStep({ ctx, repoRoot: config.repoRoot, env: config.env, target: f.containerTarget(ctx, container), execute: true, command });
}
