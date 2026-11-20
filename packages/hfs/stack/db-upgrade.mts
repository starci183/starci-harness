// db-upgrade.mts - `starci app stack db-upgrade --env <env> --image <db image@sha256> [--old-image <ref@sha256>] [--execute]` (PROJECT-STACKS-19): the
// sanctioned Postgres major upgrade of a Swarm environment's own database, a dump and restore into a NEW volume (db-upgrade-core.mts) that keeps the old
// volume byte for byte for rollback. A dev (docker-compose) environment runs local-db-upgrade.mts instead.
// Both volumes come from the declaration, never from a guess: the new volume is the one the stack source mounts as the database's data directory (one of
// `deploy.volumes`), and the old one is what it maps from, in `deploy.dbUpgrade.volumes: {<new>: <old>}` (the stack keeps its name) or in
// `deploy.renamedFrom.volumes` (the stack is renamed at the same time; the old service is then the old stack's). Without a mapping the verb refuses and
// prints the YAML to add (STACK_DB_UPGRADE_UNDECLARED).
// Preflight (the dry run, which changes nothing): the old volume's PG_VERSION (read-only mount) against the target image's major (STACK_DB_UPGRADE_ALREADY,
// STACK_DB_UPGRADE_DOWNGRADE), nothing running mounts either volume (STACK_DB_UPGRADE_IN_USE: stack standby first), the new volume absent or empty, the
// old-major image (--old-image; else the image the old service ran when it is of that major; else the pinned official image of that major), and the
// superuser password: the sealed value the deploy grants the database service under the file its POSTGRES_PASSWORD_FILE names, whose versioned Swarm
// secret name must be the one the service runs with (STACK_DB_UPGRADE_PASSWORD_DRIFT otherwise). An executed upgrade is one recorded attempt (kind
// `db-upgrade`) under the deploy lock, every step a phase of the journal and its record (`upgrade`: volumes, majors, images, inventory, measures).
// The switch is `stack deploy --env <env> --adopt` (adopt.mts): with `dbUpgrade` it starts the database alone on the upgraded volume, proves its history,
// runs the plain database path, then deploys; with `renamedFrom` it is the adopted first release of the renamed stack.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { DeployConfig } from './config.mjs';
import { readYaml } from './config.mjs';
import { firstLine, tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { appRoleOf, declaredDatabase } from './db-phases.mjs';
import { DATA_MOUNT, UpgradeStop, dataSubpath, imageMajor, pinnedOldImage, readCluster, runUpgrade } from './db-upgrade-core.mjs';
import type { UpgradeDeps, UpgradeLogin, UpgradeRecord, UpgradeSite } from './db-upgrade-core.mjs';
import { refusal } from './errors.mjs';
import { recordedAttempt } from './journal.mjs';
import { createReleaseStore } from './release-store.mjs';
import type { ReleaseStore } from './release-store.mjs';
import { ownerSshRunner } from './remote.mjs';
import type { ActionResult, Runner, SshOptions } from './remote.mjs';
import { loadSealed, openMember, requireAgeIdentity } from './sealed.mjs';
import type { LoadedSealed } from './sealed.mjs';
import { gateIsOn } from './ssh-gate.mjs';
import { stackServiceFacts } from './standby.mjs';
import { volumeEmpty, volumeExists, volumeUsers } from './volume.mjs';

/** What `stack db-upgrade` takes. */
export interface DbUpgradeOptions extends SshOptions {
  image?: string | undefined;
  oldImage?: string | undefined;
  execute?: boolean | undefined;
  lockWaitSeconds?: number | undefined;
}

/** The collaborators a caller replaces: the manager's runner and its release store, the sealed custody and the upgrade's own seams. */
export interface DbUpgradeDeps {
  ssh?: Runner | undefined;
  releaseStore?: ((config: DeployConfig, run: Runner) => ReleaseStore) | undefined;
  sealed?: ((ctx: StackContext, config: DeployConfig) => LoadedSealed) | undefined;
  core?: UpgradeDeps | undefined;
}

/** The pair of one upgrade and where it was declared. */
export interface UpgradePair { from: string; to: string; mount: string; declaredIn: 'dbUpgrade' | 'renamedFrom'; sourceStack: string }

const PINNED = /@sha256:[a-f0-9]{64}$/u;
/** The superuser password file the official image reads (POSTGRES_PASSWORD_FILE) must be a Swarm secret: a file under /run/secrets. */
const SECRET_FILE = /^\/run\/secrets\/([A-Za-z0-9_.-]+)$/u;
const VERSION_SUFFIX = /-v[0-9a-f]{10}$/u;

/** One `docker service inspect` spec, read defensively. */
// reason: `docker service inspect` JSON
type ServiceSpec = any;

/** The named volume a stack service mounts at `mount` in the stack source, as Swarm names it (an external volume by its name, any other `<stack>_<key>`). */
export function sourceDataVolume(config: Pick<DeployConfig, 'stackFile' | 'stack'>, service: string, mount = DATA_MOUNT): { volume: string; mount: string } | null {
  const model = readYaml(config.stackFile, 'the stack source');
  const entries: unknown[] = Array.isArray(model?.services?.[service]?.volumes) ? model.services[service].volumes : [];
  for (const entry of entries) {
    const [source, target] = typeof entry === 'string' ? entry.split(':') : [(entry as { source?: unknown })?.source, (entry as { target?: unknown })?.target];
    if (typeof source !== 'string' || typeof target !== 'string' || target.replace(/\/+$/u, '') !== mount) continue;
    const declared = model?.volumes?.[source];
    if (declared === undefined) return null;
    const name = typeof declared?.name === 'string' ? declared.name : declared?.external === true ? source : `${config.stack}_${source}`;
    return { volume: name, mount };
  }
  return null;
}

/** The YAML an environment adds to declare the upgrade of `next`. */
export const upgradeYaml = (env: string, next: string): string => [
  `environments:`, `  ${env}:`, `    deploy:`, `      volumes: [..., ${next}]`, `      dbUpgrade:`, `        volumes:`, `          ${next}: <the old volume that holds the data directory of the old major>`,
].join('\n');

/** The pair of the upgrade from the declaration (see the header); refused when the stack source mounts no declared data volume or nothing maps it. */
export function upgradePair(config: DeployConfig, service: string): UpgradePair {
  const declared = sourceDataVolume(config, service);
  if (!declared) throw refusal('STACK_DB_UPGRADE_NO_DATA_VOLUME', `the stack source ${path.basename(config.stackFile)} mounts no named volume at ${DATA_MOUNT} in the service ${service}: the new volume of an upgrade is the database's declared data volume`);
  const next = declared.volume;
  const explicit = config.dbUpgrade ? Object.entries(config.dbUpgrade.volumes)[0] : undefined;
  if (explicit && explicit[0] !== next) throw refusal('STACK_DB_UPGRADE_UNDECLARED', `deploy.dbUpgrade maps ${explicit[0]}, but the stack source mounts ${next} as the data directory of ${service}: point the service at the new volume, or map that one`);
  if (explicit) return { from: explicit[1], to: next, mount: declared.mount, declaredIn: 'dbUpgrade', sourceStack: config.stack };
  const renamed = config.renamedFrom?.volumes[next];
  if (renamed && config.renamedFrom) return { from: renamed, to: next, mount: declared.mount, declaredIn: 'renamedFrom', sourceStack: config.renamedFrom.stack };
  if (!config.volumes.includes(next)) throw refusal('STACK_DB_UPGRADE_UNDECLARED', `${next}, the data volume the stack source mounts for ${service}, is not one of environments.${config.env}.deploy.volumes; declare the new volume and the old one it is restored from:\n${upgradeYaml(config.env, next)}`);
  throw refusal('STACK_DB_UPGRADE_UNDECLARED', `nothing maps the new database volume ${next} to the old volume it is restored from; the verb never guesses a volume name. Add:\n${upgradeYaml(config.env, next)}`);
}

/** The spec of one Swarm service, or null when it does not exist. */
function serviceSpec(ctx: Pick<StackContext, 'spawn'>, name: string): ServiceSpec | null {
  const run = tool(ctx, 'docker', ['service', 'inspect', '--format', '{{json .Spec}}', name]);
  if (run.status !== 0) return null;
  try { return JSON.parse(String(run.stdout).trim()); } catch { return null; }
}

/** The environment of a service spec as a map. */
const envOf = (spec: ServiceSpec): Record<string, string> => Object.fromEntries((spec?.TaskTemplate?.ContainerSpec?.Env ?? []).map((item: string) => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]));

/** Makes the image present on the manager (inspect, then pull). */
function ensureImage(ctx: Pick<StackContext, 'spawn'>, image: string, what: string): void {
  if (tool(ctx, 'docker', ['image', 'inspect', image]).status === 0) return;
  const pulled = tool(ctx, 'docker', ['pull', '-q', image]);
  if (pulled.status !== 0) throw refusal('STACK_DB_UPGRADE_IMAGE', `cannot pull ${what} ${image}: ${firstLine(pulled.stderr)}`);
}

/**
 * The sealed superuser password the deploy grants the database service: the key of the file its POSTGRES_PASSWORD_FILE names, from the environment's grants.
 * When the service runs that secret under a versioned name, the custody value must give the same version (the HMAC of key and value), so custody and the
 * running database agree before anything changes.
 */
export function sealedPassword(spec: ServiceSpec, sealed: LoadedSealed, service: string, granted: string): { key: string; value: string } {
  const env = envOf(spec);
  const file = env.POSTGRES_PASSWORD_FILE;
  const found = typeof file === 'string' ? SECRET_FILE.exec(file) : null;
  if (!found) throw refusal('STACK_DB_UPGRADE_NO_PASSWORD', `${service} does not read its superuser password from a Swarm secret (POSTGRES_PASSWORD_FILE=/run/secrets/<KEY>): the upgrade initialises the new volume with the sealed password only`);
  const key = found[1] as string;
  const secret = sealed.secrets[key];
  if (!secret || !(sealed.grants[granted] ?? []).includes(key)) throw refusal('STACK_DB_UPGRADE_NO_PASSWORD', `${service} reads ${file}, and no sealed grant of this environment gives the service ${granted} the key ${key}`);
  const running = (spec?.TaskTemplate?.ContainerSpec?.Secrets ?? []).find((item: ServiceSpec) => item?.File?.Name === key)?.SecretName as string | undefined;
  const version = (name: string): string | null => VERSION_SUFFIX.exec(name)?.[0] ?? null;
  if (running && version(running) && version(running) !== version(secret.runtimeName)) {
    throw refusal('STACK_DB_UPGRADE_PASSWORD_DRIFT', `${service} runs ${key} as ${running}, and the sealed custody gives ${secret.runtimeName}: custody and the running database disagree on the superuser password; settle it before an upgrade`);
  }
  return { key, value: secret.value };
}

/** The old-major image: --old-image, else the image the old service ran when it is of that major, else the pinned official image of that major. */
function oldImageOf(ctx: StackContext, options: DbUpgradeOptions, ran: string | null, major: string, uid: number | null): { image: string; why: string } {
  if (options.oldImage) {
    if (!PINNED.test(options.oldImage)) throw refusal('STACK_USAGE', '--old-image takes a digest-pinned reference (<repo>:<tag>@sha256:<64 hex>)');
    ensureImage(ctx, options.oldImage, 'the old-major image');
    const got = imageMajor(ctx, options.oldImage);
    if (got !== major) throw refusal('STACK_DB_UPGRADE_OLD_IMAGE', `--old-image ${options.oldImage} runs PostgreSQL ${got ?? '?'}, and the old volume holds a ${major} data directory`);
    return { image: options.oldImage, why: '--old-image' };
  }
  if (ran && tool(ctx, 'docker', ['image', 'inspect', ran]).status === 0 && imageMajor(ctx, ran) === major) return { image: ran, why: 'the image the old service ran' };
  const pinned = pinnedOldImage(major, uid);
  if (!pinned) throw refusal('STACK_DB_UPGRADE_NO_OLD_IMAGE', `no image of PostgreSQL ${major} is known: the old service's image is gone or of another major, and the harness pins no official ${major} image; name one with --old-image <ref@sha256:...>`);
  ensureImage(ctx, pinned, 'the pinned old-major image');
  return { image: pinned, why: `the pinned official image of ${major}${uid === 70 ? ' (alpine: the data directory is owned by uid 70)' : ''}` };
}

/** Everything the dry run proves and the executed run needs; changes nothing. */
async function preflight(ctx: StackContext, config: DeployConfig, options: DbUpgradeOptions, deps: DbUpgradeDeps): Promise<{ site: Omit<UpgradeSite, 'prefix'>; record: UpgradeRecord; lines: string[] }> {
  const database = await declaredDatabase(ctx, config);
  if (!database || database.target !== 'stack') throw refusal('STACK_DB_UPGRADE_NO_DATABASE', `stack db-upgrade upgrades a database the stack runs itself: declare the database block with target: stack (an external database is upgraded by its provider)`);
  const pair = upgradePair(config, database.service);
  if (!options.image || !PINNED.test(options.image)) throw refusal('STACK_DB_UPGRADE_IMAGE', '--image names the db image the next deploy runs, digest-pinned (<repo>:<tag>@sha256:<64 hex>): the restore is proven with it');
  ensureImage(ctx, options.image, 'the db image');
  const newMajor = imageMajor(ctx, options.image);
  if (!newMajor) throw refusal('STACK_DB_UPGRADE_IMAGE', `${options.image} answers no PostgreSQL version (postgres --version)`);
  if (!volumeExists(ctx, pair.from)) throw refusal('STACK_DB_UPGRADE_VOLUME_MISSING', `the old volume ${pair.from} does not exist on the manager; nothing was changed`);
  const users = [pair.from, pair.to].filter((volume) => volumeExists(ctx, volume)).flatMap((volume) => volumeUsers(ctx, volume).map((user) => `${volume}: ${user}`));
  if (users.length > 0) throw refusal('STACK_DB_UPGRADE_IN_USE', `${users.join('; ')}: stop the stack first (stack standby --env ${config.env}${pair.declaredIn === 'renamedFrom' ? ' --renamed-from' : ''} --execute); nothing was changed`);
  if (volumeExists(ctx, pair.to) && !volumeEmpty(ctx, options.image, pair.to)) throw refusal('STACK_DB_UPGRADE_TARGET_NOT_EMPTY', `the new volume ${pair.to} is not empty: an upgrade restores into an empty volume only; nothing was changed`);
  // The service the old volume served: the one of the source stack that mounts it (the database service may have been renamed with the upgrade).
  const serving = stackServiceFacts(ctx, pair.sourceStack).find((facts) => facts.volumes.includes(pair.from))?.name;
  const serviceName = serving ?? `${pair.sourceStack}_${database.service}`;
  const spec = serviceSpec(ctx, serviceName);
  if (!spec) throw refusal('STACK_DB_UPGRADE_NO_SERVICE', `no service of ${pair.sourceStack} mounts ${pair.from}, and ${serviceName} does not exist on this swarm: the upgrade reads its superuser, database and password from the service the old volume served`);
  const env = envOf(spec);
  const pgdata = env.PGDATA ?? pair.mount;
  const sub = dataSubpath(pgdata, pair.mount);
  if (sub === null) throw refusal('STACK_DB_UPGRADE_NOT_A_CLUSTER', `PGDATA ${pgdata} of ${serviceName} is not at or below the volume's mount ${pair.mount}`);
  const cluster = readCluster(ctx, options.image, pair.from, sub);
  if (!cluster.version) throw refusal('STACK_DB_UPGRADE_NOT_A_CLUSTER', `${pair.from} holds no PG_VERSION${sub ? ` under ${sub}` : ''}: it is not a PostgreSQL data directory; nothing was changed`);
  const oldMajor = cluster.version;
  if (oldMajor === newMajor) throw refusal('STACK_DB_UPGRADE_ALREADY', `${pair.from} already holds a PostgreSQL ${oldMajor} data directory, the major of ${options.image}: there is nothing to upgrade`);
  if (Number(oldMajor) > Number(newMajor)) throw refusal('STACK_DB_UPGRADE_DOWNGRADE', `${pair.from} holds PostgreSQL ${oldMajor}, newer than ${newMajor} of ${options.image}: a major is never downgraded`);
  const old = oldImageOf(ctx, options, typeof spec?.TaskTemplate?.ContainerSpec?.Image === 'string' ? spec.TaskTemplate.ContainerSpec.Image : null, oldMajor, cluster.uid);
  requireAgeIdentity(ctx, config, 'stack db-upgrade');
  const sealed = (deps.sealed ?? loadSealed)(ctx, config);
  // The grants are this environment's; a renamed stack's old service ran the same keys under the old stack's names.
  const password = sealedPassword(spec, sealed, serviceName, database.service);
  const superuser = env.POSTGRES_USER ?? 'postgres';
  const db = env.POSTGRES_DB ?? superuser;
  const app = appRoleOf(config, database);
  const logins: UpgradeLogin[] = app ? [{ role: app.role, database: db, what: 'the app role', password: () => String(openMember(ctx, config, app.ref.member)[app.ref.key] ?? '') }] : [];
  const site = { oldVolume: pair.from, newVolume: pair.to, oldImage: old.image, image: options.image, pgdata, mount: pair.mount, superuser, database: db, initdbArgs: env.POSTGRES_INITDB_ARGS ?? null, password: () => password.value, logins };
  const record: UpgradeRecord = { from: pair.from, to: pair.to, oldMajor, newMajor, oldImage: old.image, image: options.image, before: { files: 0, bytes: 0, content: '', meta: '' }, after: null, inventory: null, createdTarget: false };
  const lines = [
    `db-upgrade of ${serviceName} (declared in deploy.${pair.declaredIn}): PostgreSQL ${oldMajor} -> ${newMajor}`,
    `  old volume ${pair.from}: PG_VERSION ${oldMajor}, mounted read-only only; it stays untouched for rollback`,
    `  new volume ${pair.to}: ${volumeExists(ctx, pair.to) ? 'exists and is empty' : 'absent: the upgrade creates it'}`,
    `  old-major image ${old.image} (${old.why}); target image ${options.image}`,
    `  superuser ${superuser}, database ${db}: the sealed ${password.key} the deploy grants the service${app ? `; the app role ${app.role} is proven with its sealed password too` : ''}`,
    ...(cluster.autoSettings.length > 0 ? [`  note: postgresql.auto.conf of ${pair.from} sets ${cluster.autoSettings.join(', ')}; ALTER SYSTEM settings are not carried, set them again after the switch`] : []),
  ];
  return { site, record, lines };
}

/** The switch the verb hands over to. */
const nextSteps = (config: DeployConfig, pair: { declaredIn: string }, image: string): string[] => [
  `next: stack deploy --env ${config.env} --adopt --image <service>=<ref> ... (the db service with ${image}) --sha <sha> --execute starts the database alone on the new volume, proves its history and deploys`,
  pair.declaredIn === 'dbUpgrade' ? `rollback: stack rollback --env ${config.env} --data-acknowledged --execute redeploys the release before the upgrade, on the old volume with the old image` : 'rollback: stack rollback --env <env> --data-acknowledged --execute of the adopted release resumes the old stack on its own volumes',
];

/** `stack db-upgrade` (see the header). */
export async function runDbUpgrade(ctx: StackContext, config: DeployConfig, options: DbUpgradeOptions = {}, deps: DbUpgradeDeps = {}): Promise<ActionResult> {
  const planned = await preflight(ctx, config, options, deps);
  const declaredIn = config.dbUpgrade ? 'dbUpgrade' : 'renamedFrom';
  if (options.execute !== true) {
    return { ok: true, lines: [...planned.lines, 'dry run: --execute copies the old volume into a work copy, starts both majors there with no network, dumps, restores, compares the inventories and proves the sealed logins; the old volume is never written', ...nextSteps(config, { declaredIn }, planned.record.image)], data: { executed: false, from: planned.record.from, to: planned.record.to, oldMajor: planned.record.oldMajor, newMajor: planned.record.newMajor } };
  }
  const run = deps.ssh ?? ownerSshRunner(ctx, config, { sshCmd: options.sshCmd ?? null });
  try {
    const store = deps.releaseStore ? deps.releaseStore(config, run) : createReleaseStore(config, run, { gated: gateIsOn(ctx.env) });
    return await recordedAttempt(ctx, config, store, { kind: 'db-upgrade', trigger: 'dispatch' }, { waitSeconds: options.lockWaitSeconds }, async (rec) => {
      // Checked again under the lock: nothing may have started on either volume since the first look.
      const { site, record, lines } = await rec.phase('check', () => preflight(ctx, config, options, deps));
      const keep = (): void => rec.note({ upgrade: { ...record, attempt: rec.id } as unknown as Record<string, unknown> });
      try {
        lines.push(...await runUpgrade(ctx, { ...site, prefix: `starci-dbu-${randomBytes(4).toString('hex')}` }, (name, action, passed) => rec.phase(name, action, passed), record, deps.core));
      } catch (error) {
        keep();
        if (!(error instanceof UpgradeStop)) throw error;
        return { ok: false, refused: { code: error.code, message: `${error.message}; ${record.from} is untouched and stays the database's volume` }, lines: [...lines, ...error.lines], data: { executed: true, upgrade: record } };
      }
      keep();
      return { ok: true, lines: [...lines, `db-upgrade: ${record.to} holds the PostgreSQL ${record.newMajor} restore of ${record.from}, proven equal`, ...nextSteps(config, { declaredIn }, record.image)], data: { executed: true, upgrade: record } };
    });
  } finally {
    if (!deps.ssh) run.cleanup?.();
  }
}
