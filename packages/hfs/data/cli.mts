// cli.mts - `starci app data <status|verify|sync>`: the explicit read of a seed-backup copy (PROJECT-STACKS-13, PROJECT-STACKS-14).
//   starci app data status --env <env> [--set <id>] [--json]
//   starci app data verify --env <env> --set <id> [--from <commit>] [--json]
//   starci app data sync   --env <env> --set <id> --from <commit> [--execute] [--json]
// A backup is read only here, only into the SAME environment, and the sync is a dry run until --execute: it prints, per store and set, what an
// import would create, update, leave and remove, and --execute applies it with mode `merge` (a mirror sync is not built: nothing is removed).
// Refusals are typed (exit 2): DATA_SYNC_PURPOSE, DATA_SYNC_OTHER_ENVIRONMENT, DATA_SYNC_SNAPSHOT_MISSING, DATA_SYNC_COPY_UNHEALTHY,
// DATA_SYNC_TARGET_UNPROTECTED; no value, no identity and no store error text is ever printed.
import { restoreFrom } from '@starci/seed';
import type { CopyRef, CopyVerdict, ImportReport, OpenContext, StoreAdapter } from '@starci/seed';
import { runVerb } from '../release/index.mjs';
import type { FlagSpec, VerbContext, VerbFlags, VerbIo, VerbResult } from '../release/index.mjs';
import { StackError, refusal } from '../stack/errors.mjs';
import type { AgeHost } from '../runtime/scripts/hfs/secret-init.mjs';
import { gitDestination, loadDataDeclaration, requireEnvironment } from './declaration.mjs';
import type { DataDeclaration, DeclaredSet } from './declaration.mjs';
import { openCopy, openIdentity } from './copies.mjs';
import type { OpenCopy } from './copies.mjs';
import { openLocalStores } from './stores.mjs';
import type { StoreOpener } from './stores.mjs';

/** The actions of the verb. */
export const DATA_ACTIONS: readonly string[] = ['status', 'verify', 'sync'];
/** The flags of `starci app data`; the parser refuses every other. */
export const SPEC: FlagSpec = { boolean: ['--execute', '--json'], value: ['--env', '--set', '--from'] };
/** The usage lines of the verb. */
export const DATA_USAGE: readonly string[] = [
  'starci app data status --env <env> [--set <id>] [--json]',
  'starci app data verify --env <env> --set <id> [--from <commit>] [--json]',
  'starci app data sync --env <env> --set <id> --from <commit> [--execute] [--json]',
];

/** What a spec (or a host) replaces: how the target stores are reached, and the harness's age host. */
export interface DataDeps { stores?: StoreOpener | undefined; host?: AgeHost | null | undefined }

/** The newest copies `status` lists. */
const STATUS_COPIES = 5;
const MIB = 1_048_576;
const short = (text: string): string => text.slice(0, 12);

/** The seed-backup set of an environment that `--set` names, with its repository resolved; the refusals of PROJECT-STACKS-13 come from here. */
function backupSet(declaration: DataDeclaration, env: string, id: string): { set: DeclaredSet; destination: { repository: string; name: string } } {
  const set = declaration.sets.find((item) => item.id === id);
  if (set === undefined) throw refusal('DATA_USAGE', `--set ${id} is not a data set of the stack (${declaration.sets.map((item) => item.id).join(', ')})`);
  if (set.purpose !== 'seed-backup') throw refusal('DATA_SYNC_PURPOSE', `the set ${id} is a ${set.purpose}: only a seed-backup is read by starci app data, a standard is never synced (it is loaded once by the bring-up)`);
  if (!set.environments.includes(env)) throw refusal('DATA_SYNC_OTHER_ENVIRONMENT', `the set ${id} is a backup of ${set.environments.join(', ')}, not of ${env}: a backup is read only into the environment it came from`);
  const destination = gitDestination(declaration, set, env);
  if (destination === null) throw refusal('DATA_COPY_UNREACHABLE', `the set ${id} names no git destination: starci app data reads git copies only`);
  const label = declaration.environments.get(env) as string;
  for (const [other, otherLabel] of declaration.environments) {
    if (other !== env && otherLabel !== label && destination.name.endsWith(`-seed-backup-${otherLabel}`)) throw refusal('DATA_SYNC_OTHER_ENVIRONMENT', `the repository ${destination.name} of the set ${id} is the backup of ${other}, not of ${env}`);
  }
  return { set, destination };
}

const required = (flags: VerbFlags, name: string, action: string): string => {
  const value = flags[name];
  if (typeof value !== 'string' || value === '') throw refusal('DATA_USAGE', `data ${action} needs --${name}`);
  return value;
};

/** The copy `--from` names (a commit of the repository), or the newest the driver lists. */
async function chooseRef(open: OpenCopy, from: string | undefined): Promise<CopyRef> {
  if (from === undefined) {
    const newest = (await open.driver.list())[0];
    if (newest === undefined) throw refusal('DATA_SYNC_SNAPSHOT_MISSING', `the repository ${open.name} holds no copy yet`);
    return newest;
  }
  const commit = open.resolve(from);
  const ref = commit === null ? null : open.refAt(commit);
  if (ref === null) throw refusal('DATA_SYNC_SNAPSHOT_MISSING', `the repository ${open.name} has no snapshot at ${from}`);
  return ref;
}

/** A copy of another environment is refused where this one is read, by the environment its manifest records. */
function requireSameEnvironment(open: OpenCopy, ref: CopyRef, env: string): void {
  const taken = open.manifestAt(ref.locator)?.source.environment;
  if (taken !== env) throw refusal('DATA_SYNC_OTHER_ENVIRONMENT', `the snapshot ${short(ref.locator)} was taken in ${taken === undefined || taken === '' ? 'an unknown environment' : taken}, not in ${env}: a backup is read only into the environment it came from`);
}

const failedChecks = (verdict: CopyVerdict): string => verdict.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`).join('; ');

/** `status`: per backup set of the environment, the newest copies with their size against the cap. Read-only; no identity is needed. */
async function status(ctx: VerbContext, declaration: DataDeclaration, env: string, flags: VerbFlags): Promise<VerbResult> {
  const only = flags.set;
  const sets = typeof only === 'string' ? [backupSet(declaration, env, only).set] : declaration.sets.filter((set) => set.purpose === 'seed-backup' && set.environments.includes(env));
  const lines: string[] = [];
  const data: unknown[] = [];
  if (sets.length === 0) lines.push(`${env}: no seed-backup set`);
  let ok = true;
  for (const set of sets) {
    let destination: { repository: string; name: string };
    try { destination = backupSet(declaration, env, set.id).destination; } catch (error) {
      // A listing keeps going past a set whose declaration is refused: the refusal is that set's line, and the run is red.
      if (typeof only === 'string' || !(error instanceof StackError)) throw error;
      ok = false;
      lines.push(`set ${set.id}: REFUSED ${error.message}`);
      data.push({ set: set.id, refused: error.code });
      continue;
    }
    const open = openCopy(ctx, declaration.project, destination);
    open.refresh();
    const cap = open.driver.limits().maxCopyBytes;
    lines.push(`set ${set.id} (seed-backup, ${env}) in ${destination.name}`);
    const copies = (await open.driver.list()).slice(0, STATUS_COPIES);
    if (copies.length === 0) lines.push('  no copy yet');
    const listed: unknown[] = [];
    for (const ref of copies) {
      const manifest = open.manifestAt(ref.locator);
      const verdict = await open.driver.verify(ref, null);
      const bytes = Object.values(manifest?.files ?? {}).reduce((sum, file) => sum + file.bytes, 0);
      const stores: Record<string, number> = {};
      for (const entry of manifest?.sets ?? []) stores[entry.store] = (stores[entry.store] ?? 0) + entry.items;
      const room = cap === null ? '' : ` of ${String(Math.round(cap / MIB))} MiB (${(bytes * 100 / cap).toFixed(1)}%)`;
      lines.push(`  ${short(ref.locator)}  taken ${ref.takenAt}  export ${short(ref.exportDigest)}  sealed ${(bytes / MIB).toFixed(2)} MiB${room}  ${verdict.healthy ? 'healthy' : `FAILED ${failedChecks(verdict)}`}`);
      lines.push(`    ${Object.entries(stores).map(([store, items]) => `${store}: ${String(items)} items`).join(', ') || 'no set'}${manifest !== null && manifest.source.environment !== env ? `  (taken in ${manifest.source.environment})` : ''}`);
      listed.push({ commit: ref.locator, takenAt: ref.takenAt, exportDigest: ref.exportDigest, sealedBytes: bytes, capBytes: cap, items: stores, healthy: verdict.healthy, environment: manifest?.source.environment ?? null });
    }
    data.push({ set: set.id, repository: destination.name, copies: listed });
  }
  return { ok, lines, data: { action: 'status', environment: env, sets: data } };
}

/** `verify`: the driver's verify of one copy with the identity: structure, sealing, files, cap and every digest. Read-only. */
async function verify(ctx: VerbContext, declaration: DataDeclaration, env: string, flags: VerbFlags, host: AgeHost | null): Promise<VerbResult> {
  const { set, destination } = backupSet(declaration, env, required(flags, 'set', 'verify'));
  const open = openCopy(ctx, declaration.project, destination);
  open.refresh();
  const ref = await chooseRef(open, typeof flags.from === 'string' ? flags.from : undefined);
  requireSameEnvironment(open, ref, env);
  const verdict = await open.driver.verify(ref, openIdentity(ctx, host));
  const lines = [`verify ${set.id} (${env}) ${short(ref.locator)} taken ${ref.takenAt}: ${verdict.healthy ? 'healthy' : 'UNHEALTHY'}`, ...verdict.checks.map((check) => `  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`)];
  return { ok: verdict.healthy, lines, data: { action: 'verify', environment: env, set: set.id, commit: ref.locator, healthy: verdict.healthy, checks: verdict.checks } };
}

/** Whether any selected set of any of the stores holds an entry: the target is not empty. The export is read to its first entry only. */
async function holdsData(stores: readonly StoreAdapter[], sets: readonly { store: string; set: string }[]): Promise<boolean> {
  for (const store of stores) {
    const names = sets.filter((item) => item.store === store.id).map((item) => item.set);
    if (names.length === 0) continue;
    const entries = store.export({ sets: names })[Symbol.asyncIterator]();
    const first = await entries.next();
    await entries.return?.();
    if (first.done !== true) return true;
  }
  return false;
}

/**
 * Whether the target is protected by a backup (the reset rule of PROJECT-STACKS-6, "take a backup first"): a healthy copy taken in THIS environment,
 * younger than the set's `maxAgeMinutes`, and not the snapshot being synced.
 */
async function protectedByBackup(ctx: VerbContext, open: OpenCopy, env: string, set: DeclaredSet, snapshot: CopyRef, identity: OpenContext): Promise<boolean> {
  const youngest = ctx.now() - set.maxAgeMinutes * 60_000;
  for (const ref of await open.driver.list()) {
    if (ref.locator === snapshot.locator || !(Date.parse(ref.takenAt) >= youngest) || open.manifestAt(ref.locator)?.source.environment !== env) continue;
    if ((await open.driver.verify(ref, identity)).healthy) return true;
  }
  return false;
}

const countsOf = (reports: readonly ImportReport[], storeOf: (set: string) => string): string[] =>
  reports.flatMap((report) => report.sets.map((item) => `  ${storeOf(item.set)}/${item.set}  created ${String(item.created)}  updated ${String(item.updated)}  unchanged ${String(item.unchanged)}  removed ${String(item.removed)}${item.refused.length === 0 ? '' : `  REFUSED ${String(item.refused.length)} (${[...new Set(item.refused.map((key) => key.code))].join(', ')})`}`));

/** `sync`: the snapshot into the SAME environment's stores, merge mode; dry unless `--execute`. */
async function sync(ctx: VerbContext, declaration: DataDeclaration, env: string, flags: VerbFlags, deps: DataDeps): Promise<VerbResult> {
  const { set, destination } = backupSet(declaration, env, required(flags, 'set', 'sync'));
  const execute = flags.execute === true;
  const open = openCopy(ctx, declaration.project, destination);
  open.refresh();
  const ref = await chooseRef(open, required(flags, 'from', 'sync'));
  requireSameEnvironment(open, ref, env);
  const identity = openIdentity(ctx, deps.host ?? null);
  const verdict = await open.driver.verify(ref, identity);
  if (!verdict.healthy || verdict.manifest === null) throw refusal('DATA_SYNC_COPY_UNHEALTHY', `the snapshot ${short(ref.locator)} does not verify (${failedChecks(verdict)}): nothing was read into ${env}`);
  const declared = set.stores.flatMap((id) => declaration.stores.filter((store) => store.id === id));
  if (declared.length !== set.stores.length) throw refusal('DATA_SYNC_STORE_COMMAND', `the set ${set.id} names a store that data.stores does not declare`);
  const stores = (deps.stores ?? openLocalStores)(ctx, env, declared);
  if (await holdsData(stores, verdict.manifest.sets) && !(await protectedByBackup(ctx, open, env, set, ref, identity))) {
    throw refusal('DATA_SYNC_TARGET_UNPROTECTED', `the stores of ${env} hold data and no healthy backup of ${env} younger than ${String(set.maxAgeMinutes)} minutes other than this snapshot exists: take a backup first (the reset rule of PROJECT-STACKS-6)`);
  }
  const source = await open.driver.read(ref, identity);
  const reports = await restoreFrom(source, stores, { dryRun: !execute, mode: 'merge' });
  const outcome = reports.some((report) => report.outcome === 'partial') ? 'partial' : reports.some((report) => report.outcome === 'applied') ? 'applied' : 'unchanged';
  const at = new Date(ctx.now()).toISOString();
  const receipt = `receipt: data sync ${set.id} into ${env} from ${short(ref.locator)} (export ${short(ref.exportDigest)}, taken ${ref.takenAt}) ${execute ? 'executed' : 'dry run'} ${at} outcome ${outcome}`;
  const lines = [`sync ${set.id} into ${env}: ${execute ? 'executing' : 'dry run'}, mode merge (nothing is removed), snapshot ${short(ref.locator)} taken ${ref.takenAt}`, ...countsOf(reports, (name) => verdict.manifest?.sets.find((item) => item.set === name)?.store ?? '?'), receipt,
    ...(execute ? [] : ['dry run: nothing was written; add --execute to apply'])];
  return { ok: outcome !== 'partial', lines, data: { action: 'sync', environment: env, set: set.id, commit: ref.locator, execute, mode: 'merge', outcome, receipt, reports } };
}

/** `starci app data`: the exit code is 0 clean, 1 a failed step (a refused key), 2 a refusal or usage. */
export function dataMain(argv: string[], io: VerbIo = {}, deps: DataDeps = {}): Promise<number> {
  return runVerb({ label: 'starci app data', name: 'data', code: 'DATA_USAGE', io, argv, spec: SPEC,
    run: async (ctx, flags, positional) => {
      const [action, ...rest] = positional;
      if (action === undefined || !DATA_ACTIONS.includes(action) || rest.length > 0) throw refusal('DATA_USAGE', `starci app data takes ${DATA_ACTIONS.join(', ')} and no other operand`);
      if (action !== 'sync' && flags.execute === true) throw refusal('DATA_USAGE', `data ${action} is read-only: --execute belongs to sync`);
      if (action === 'status' && flags.from !== undefined) throw refusal('DATA_USAGE', 'data status takes no --from');
      const declaration = loadDataDeclaration(ctx.cwd);
      const env = required(flags, 'env', action);
      requireEnvironment(declaration, env);
      const host = deps.host === undefined ? ((io.hostIdentity ?? null) as AgeHost | null) : deps.host;
      if (action === 'status') return status(ctx, declaration, env, flags);
      if (action === 'verify') return verify(ctx, declaration, env, flags, host);
      return sync(ctx, declaration, env, flags, { ...deps, host });
    } });
}
