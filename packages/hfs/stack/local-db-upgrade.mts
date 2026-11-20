// local-db-upgrade.mts - `starci app stack db-upgrade --env <dev env> [--old-image <ref>] [--execute]` (PROJECT-STACKS-19): the Postgres major upgrade of a
// docker-compose dev environment's database, every step in containers (no host psql). The volumes are declared, never guessed, in `local.dbUpgrade`,
// exactly one of:
//   from       the old docker volume: it is restored into the database volume the compose file mounts (absent or empty) and never written
//   hold       the compose file mounts the old volume itself and keeps its name: the upgrade works in place, the old bytes held aside in this volume
//   preflight  the compose service of `local.database`, its data volume and environment (`docker compose config`), the db image built from the app's
//              compose file (a service with `build`), PG_VERSION read-only, nothing running mounts the volumes (`stack down` first), the target or the
//              hold volume absent or empty, the old-major image (--old-image; else the image the compose tag named before the build when it is of that
//              major; else the pinned official image), the sealed superuser and environment-role passwords from the dev custody
//   upgrade    db-upgrade-core.mts (from: into the declared volume; hold: into a throwaway restore volume), proven equal to the old cluster and logged
//              into with the sealed passwords
//   hold mode  the old volume copied into the hold volume, proven byte and metadata equal to the measure taken before the upgrade; then the old volume
//              emptied and the proven restore copied in, proven equal; any failure here copies the hold back
// The run is recorded in the environment's state directory (db-upgrade/<attempt>.json: phases, volumes, majors, inventory, measures) under a lock file.
// A dry run builds the db image and reads the cluster, and changes no data.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { StackContext } from './context.mjs';
import { firstLine, tool } from './context.mjs';
import { DATA_MOUNT, UpgradeStop, dataSubpath, imageMajor, pinnedOldImage, readCluster, runUpgrade } from './db-upgrade-core.mjs';
import type { PhaseRunner, UpgradeLogin, UpgradeRecord } from './db-upgrade-core.mjs';
import type { UpgradeDeps } from './db-upgrade-core.mjs';
import { refusal } from './errors.mjs';
import type { LocalConfig } from './local-config.mjs';
import { openCustody } from './local-custody.mjs';
import { compose, stateOf } from './local-run.mjs';
import type { ActionResult } from './remote.mjs';
import { helper, measureVolume, volumeEmpty, volumeExists, volumeUsers } from './volume.mjs';
import type { VolumeMeasure } from './volume.mjs';

/** What the dev `db-upgrade` takes. */
export interface LocalUpgradeOptions { execute?: boolean | undefined; oldImage?: string | undefined }
/** The seams a caller replaces. */
export interface LocalUpgradeDeps { core?: UpgradeDeps | undefined }

/** The database service as `docker compose config` resolves it. */
interface ComposeDb { volume: string; mount: string; image: string; build: boolean; env: Record<string, string> }

/** The YAML a dev environment adds: the old volume to restore from, or the hold volume of an in-place upgrade. */
export const holdYaml = (env: string, volume: string): string => [
  'environments:', `  ${env}:`, '    local:', '      dbUpgrade:',
  `        from: <the old docker volume that holds the data directory, when the compose file mounts a new ${volume}>`,
  `        # or, when ${volume} itself holds the old data directory: hold: <a new docker volume that keeps it>`,
].join('\n');

/** The database service of the compose project: its data volume (the compose-resolved name), image, build and environment. */
async function composeDb(ctx: StackContext, local: LocalConfig, service: string): Promise<ComposeDb> {
  const run = await compose(ctx, local, ['config', '--format', 'json'], { label: 'compose config' });
  if (run.status !== 0) throw refusal('STACK_DB_UPGRADE_NO_SERVICE', `docker compose config failed: ${firstLine(run.stderr)}`);
  // reason: `docker compose config --format json`, read defensively
  const model: any = JSON.parse(String(run.stdout));
  const svc = model?.services?.[service];
  if (!svc) throw refusal('STACK_DB_UPGRADE_NO_SERVICE', `the compose project ${local.project} has no service ${service} (local.database.service)`);
  const mount = (svc.volumes ?? []).find((entry: any) => entry?.type === 'volume' && String(entry?.target ?? '').replace(/\/+$/u, '') === DATA_MOUNT);
  if (!mount) throw refusal('STACK_DB_UPGRADE_NO_DATA_VOLUME', `the compose service ${service} mounts no named volume at ${DATA_MOUNT}`);
  const env = Array.isArray(svc.environment) ? Object.fromEntries(svc.environment.map((item: string) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)])) : { ...svc.environment };
  return { volume: String(model?.volumes?.[mount.source]?.name ?? `${local.project}_${String(mount.source)}`), mount: DATA_MOUNT, image: String(svc.image ?? ''), build: svc.build !== undefined, env };
}

/** The image id a tag names now, or null. */
const imageId = (ctx: StackContext, ref: string): string | null => {
  const run = tool(ctx, 'docker', ['image', 'inspect', '--format', '{{.Id}}', ref]);
  return run.status === 0 ? String(run.stdout).trim() : null;
};

/** The phase runner of the dev journal: each phase is written to the attempt document as it starts and ends. */
function localJournal(ctx: StackContext, local: LocalConfig): { id: string; file: string; phase: PhaseRunner; note: (facts: Record<string, unknown>) => void; finish: (outcome: string, error: { code: string; message: string } | null) => void; release: () => void } {
  const dir = path.join(stateOf(ctx, local), 'db-upgrade');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'lock');
  try { fs.writeFileSync(lock, `${process.pid} ${new Date(ctx.now()).toISOString()}\n`, { flag: 'wx' }); } catch {
    throw refusal('STACK_DB_UPGRADE_LOCKED', `another db-upgrade of ${local.env} holds ${lock}: wait for it; remove the file only once no db-upgrade runs`);
  }
  const id = `${new Date(ctx.now()).toISOString().replaceAll(/[-:]|\.\d+/gu, '')}-${randomBytes(4).toString('hex')}`;
  const file = path.join(dir, `${id}.json`);
  const document: Record<string, unknown> & { phases: Array<{ phase: string; startedAt: string; endedAt: string | null; verdict: string }> } = {
    schema: 'starci/stack-deploy-attempt@1', attempt: id, kind: 'db-upgrade', stack: local.project, env: local.env, startedAt: new Date(ctx.now()).toISOString(), endedAt: null, phases: [], outcome: 'running', error: null,
  };
  const save = (): void => fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  save();
  const phase: PhaseRunner = async (name, action, passed = () => true) => {
    const entry = { phase: name, startedAt: new Date(ctx.now()).toISOString(), endedAt: null as string | null, verdict: 'running' };
    document.phases.push(entry);
    save();
    try {
      const value = await action();
      entry.verdict = passed(value) ? 'ok' : 'failed';
      return value;
    } catch (error) {
      entry.verdict = 'failed';
      throw error;
    } finally {
      entry.endedAt = new Date(ctx.now()).toISOString();
      save();
    }
  };
  return {
    id, file, phase,
    note: (facts) => { Object.assign(document, facts); save(); },
    finish: (outcome, error) => { document.outcome = outcome; document.error = error; document.endedAt = new Date(ctx.now()).toISOString(); save(); },
    release: () => { fs.rmSync(lock, { force: true }); },
  };
}

const same = (a: VolumeMeasure, b: VolumeMeasure): boolean => a.files === b.files && a.bytes === b.bytes && a.content === b.content && a.meta === b.meta;
const copy = (ctx: StackContext, image: string, from: string, to: string): boolean => helper(ctx, image, [`${from}:/from:ro`, `${to}:/to`], 'set -e; cp -a /from/. /to/').ok;
const empty = (ctx: StackContext, image: string, volume: string): boolean => helper(ctx, image, [`${volume}:/v`], 'find /v -mindepth 1 -delete').ok;

/** `stack db-upgrade` of a dev environment (see the header). */
export async function upgradeLocal(ctx: StackContext, local: LocalConfig, options: LocalUpgradeOptions = {}, deps: LocalUpgradeDeps = {}): Promise<ActionResult> {
  const database = local.database;
  if (!database) throw refusal('STACK_DB_UPGRADE_NO_DATABASE', `environments.${local.env}.local declares no database block: there is no database service to upgrade`);
  const before = await composeDb(ctx, local, database.service);
  const declared = local.dbUpgrade;
  if (!declared) throw refusal('STACK_DB_UPGRADE_UNDECLARED', `the dev upgrade restores from, or holds aside, a declared volume; the verb never guesses a volume name. Add:\n${holdYaml(local.env, before.volume)}`);
  const from = 'from' in declared ? declared.from : null;
  const hold = 'hold' in declared ? declared.hold : null;
  if ((from ?? hold) === before.volume) throw refusal('STACK_DB_UPGRADE_UNDECLARED', `local.dbUpgrade names ${before.volume}, the database volume itself: it must be another volume`);
  const oldVolume = from ?? before.volume;
  if (!volumeExists(ctx, oldVolume)) throw refusal('STACK_DB_UPGRADE_VOLUME_MISSING', `the old volume ${oldVolume} does not exist: there is nothing to upgrade`);
  const users = [...new Set([oldVolume, before.volume])].filter((volume) => volumeExists(ctx, volume)).flatMap((volume) => volumeUsers(ctx, volume).map((user) => `${volume}: ${user}`));
  if (users.length > 0) throw refusal('STACK_DB_UPGRADE_IN_USE', `${users.join('; ')}: stop the environment first (stack down --env ${local.env} --execute); nothing was changed`);
  if (options.oldImage !== undefined && !/^[^\s]+$/u.test(options.oldImage)) throw refusal('STACK_USAGE', '--old-image takes one image reference');
  // The image the compose tag names before the build is the one this volume last ran with, when it is still of the old major.
  const previousId = before.image ? imageId(ctx, before.image) : null;
  if (before.build) {
    const built = await compose(ctx, local, ['build', database.service], { heavy: true, label: 'compose build db' });
    if (built.status !== 0) throw refusal('STACK_DB_UPGRADE_IMAGE', `the db image of ${database.service} does not build: ${firstLine(built.stderr)}`);
  } else if (!imageId(ctx, before.image)) {
    const pulled = tool(ctx, 'docker', ['pull', '-q', before.image]);
    if (pulled.status !== 0) throw refusal('STACK_DB_UPGRADE_IMAGE', `cannot pull ${before.image}: ${firstLine(pulled.stderr)}`);
  }
  const image = before.image;
  const newMajor = imageMajor(ctx, image);
  if (!newMajor) throw refusal('STACK_DB_UPGRADE_IMAGE', `${image} answers no PostgreSQL version`);
  const pgdata = before.env.PGDATA ?? before.mount;
  const sub = dataSubpath(pgdata, before.mount);
  if (sub === null) throw refusal('STACK_DB_UPGRADE_NOT_A_CLUSTER', `PGDATA ${pgdata} is not at or below ${before.mount}`);
  const cluster = readCluster(ctx, image, oldVolume, sub);
  if (!cluster.version) throw refusal('STACK_DB_UPGRADE_NOT_A_CLUSTER', `${oldVolume} holds no PG_VERSION: it is not a PostgreSQL data directory`);
  const oldMajor = cluster.version;
  if (oldMajor === newMajor) throw refusal('STACK_DB_UPGRADE_ALREADY', `${oldVolume} already holds a PostgreSQL ${oldMajor} data directory, the major of ${image}: there is nothing to upgrade`);
  if (Number(oldMajor) > Number(newMajor)) throw refusal('STACK_DB_UPGRADE_DOWNGRADE', `${oldVolume} holds PostgreSQL ${oldMajor}, newer than ${newMajor} of ${image}`);
  if (hold && volumeExists(ctx, hold) && !volumeEmpty(ctx, image, hold)) throw refusal('STACK_DB_UPGRADE_TARGET_NOT_EMPTY', `the hold volume ${hold} is not empty: it keeps the data directory of an earlier upgrade; retire it first, once nothing needs it`);
  if (from && volumeExists(ctx, before.volume) && !volumeEmpty(ctx, image, before.volume)) throw refusal('STACK_DB_UPGRADE_TARGET_NOT_EMPTY', `the database volume ${before.volume} is not empty: a restore from ${from} fills an empty volume only; nothing was changed`);
  let old: { image: string; why: string };
  if (options.oldImage) {
    const got = imageMajor(ctx, options.oldImage);
    if (got !== oldMajor) throw refusal('STACK_DB_UPGRADE_OLD_IMAGE', `--old-image ${options.oldImage} runs PostgreSQL ${got ?? '?'}, and ${oldVolume} holds ${oldMajor}`);
    old = { image: options.oldImage, why: '--old-image' };
  } else if (previousId && imageMajor(ctx, previousId) === oldMajor) old = { image: previousId, why: `the image ${before.image} named before the build` };
  else {
    const pinned = pinnedOldImage(oldMajor, cluster.uid);
    if (!pinned) throw refusal('STACK_DB_UPGRADE_NO_OLD_IMAGE', `no image of PostgreSQL ${oldMajor} is known; name one with --old-image <ref>`);
    if (!imageId(ctx, pinned) && tool(ctx, 'docker', ['pull', '-q', pinned]).status !== 0) throw refusal('STACK_DB_UPGRADE_IMAGE', `cannot pull ${pinned}`);
    old = { image: pinned, why: `the pinned official image of ${oldMajor}` };
  }
  const superuser = before.env.POSTGRES_USER ?? database.adminUser;
  const db = before.env.POSTGRES_DB ?? superuser;
  const plan = [
    `db-upgrade of ${local.project}/${database.service}: PostgreSQL ${oldMajor} -> ${newMajor}`,
    from
      ? `  old volume ${from} (local.dbUpgrade.from): PG_VERSION ${oldMajor}, mounted read-only only; restored into ${before.volume}, the volume the compose file mounts`
      : `  volume ${before.volume}: PG_VERSION ${oldMajor}; its data directory is kept, byte for byte, in the hold volume ${hold} (local.dbUpgrade.hold)`,
    `  old-major image ${old.image} (${old.why}); target image ${image}`,
    `  superuser ${superuser}, database ${db}; the environment role ${database.role} is proven with its sealed password too`,
    ...(cluster.autoSettings.length > 0 ? [`  note: postgresql.auto.conf sets ${cluster.autoSettings.join(', ')}; ALTER SYSTEM settings are not carried`] : []),
  ];
  const plannedRun = from
    ? `dry run: --execute restores ${from} into ${before.volume} and proves it; ${from} is never written; then stack up --env ${local.env} --execute`
    : `dry run: --execute restores into a throwaway volume and proves it, then keeps the old data directory in the hold volume and swaps the proven restore in; then stack up --env ${local.env} --execute`;
  if (options.execute !== true) return { ok: true, lines: [...plan, plannedRun], data: { executed: false, volume: before.volume, from, hold, oldMajor, newMajor } };

  const custody = openCustody(ctx, local);
  const value = (key: string): string => custody.values.get(key) ?? '';
  const logins: UpgradeLogin[] = [{ role: database.role, database: database.name, what: 'the environment role', password: () => value(database.password.key) }];
  if (database.appRole && database.appPassword) {
    const ref = database.appPassword;
    logins.push({ role: database.appRole, database: database.name, what: 'the app role', password: () => value(ref.key) });
  }
  const journal = localJournal(ctx, local);
  const prefix = `starci-dbu-${journal.id.slice(-8)}`;
  // From mode restores straight into the declared volume (runUpgrade empties or removes it again on a failure); hold mode into a throwaway one.
  const restored = from ? before.volume : `${prefix}-restore`;
  const record: UpgradeRecord = { from: oldVolume, to: restored, oldMajor, newMajor, oldImage: old.image, image, before: { files: 0, bytes: 0, content: '', meta: '' }, after: null, inventory: null, createdTarget: false };
  const facts = (): Record<string, unknown> => ({ ...record, volume: before.volume, ...(from ? { from } : { hold }) });
  const lines = [...plan];
  try {
    lines.push(...await runUpgrade(ctx, { oldVolume, newVolume: restored, oldImage: old.image, image, pgdata, mount: before.mount, superuser, database: db, initdbArgs: before.env.POSTGRES_INITDB_ARGS ?? null, password: () => value(database.adminPassword.key), logins, prefix }, journal.phase, record, deps.core));
    if (hold) {
      const proven = await journal.phase('measure-restore', () => measureVolume(ctx, image, restored));
      await journal.phase('hold', () => {
        if (!volumeExists(ctx, hold) && tool(ctx, 'docker', ['volume', 'create', hold]).status !== 0) throw new UpgradeStop('STACK_DB_UPGRADE_SWAP_FAILED', `cannot create the hold volume ${hold}`);
        if (!copy(ctx, image, before.volume, hold) || !same(measureVolume(ctx, image, hold), record.before)) throw new UpgradeStop('STACK_DB_UPGRADE_SWAP_FAILED', `the hold copy ${hold} is not byte and metadata equal to ${before.volume}; ${before.volume} is untouched`);
      });
      lines.push(`  hold ${hold}: equal to the old ${before.volume} (files, bytes, content and metadata)`);
      await journal.phase('swap', () => {
        if (empty(ctx, image, before.volume) && copy(ctx, image, restored, before.volume) && same(measureVolume(ctx, image, before.volume), proven)) return;
        const back = empty(ctx, image, before.volume) && copy(ctx, image, hold, before.volume) && same(measureVolume(ctx, image, before.volume), record.before);
        throw new UpgradeStop('STACK_DB_UPGRADE_SWAP_FAILED', `the restore did not land in ${before.volume}; ${back ? `the old data directory was copied back from ${hold} and proven equal` : `COPY ${hold} BACK INTO ${before.volume} BY HAND: the copy back did not prove equal`}`);
      });
      tool(ctx, 'docker', ['volume', 'rm', '-f', restored]);
    }
    lines.push(`  ${before.volume}: now holds the proven PostgreSQL ${newMajor} restore`, `next: stack up --env ${local.env} --execute; ${from ?? `the hold volume ${hold}`} keeps the PostgreSQL ${oldMajor} data directory (image ${old.image}) until it is retired`);
    journal.note({ upgrade: facts() });
    journal.finish('done', null);
    return { ok: true, lines, data: { executed: true, attempt: journal.id, journal: journal.file, upgrade: facts() } };
  } catch (error) {
    if (hold) tool(ctx, 'docker', ['volume', 'rm', '-f', restored]);
    journal.note({ upgrade: facts() });
    if (!(error instanceof UpgradeStop)) { journal.finish('failed', { code: 'UNEXPECTED', message: firstLine((error as Error).message) }); throw error; }
    journal.finish('failed', { code: error.code, message: firstLine(error.message).slice(0, 300) });
    return { ok: false, refused: { code: error.code, message: error.message }, lines: [...lines, ...error.lines], data: { executed: true, attempt: journal.id, journal: journal.file, upgrade: facts() } };
  } finally {
    journal.release();
  }
}
