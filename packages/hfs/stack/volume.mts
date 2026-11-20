// volume.mts - `starci app stack volume <copy|verify>` (PROJECT-STACKS-18): a cold copy of a named volume on the manager, and the proof that two volumes hold
// the same tree.
//   volume copy   --env <env> [--from <volume> --to <volume>] [--verify] [--execute]
//   volume verify --env <env> [--from <volume> --to <volume>]
// Without --from and --to the pairs are the `deploy.renamedFrom.volumes` map (old -> new). Both run in throwaway containers of the environment's pinned
// backup image (`deploy.backup.image`) on the manager, through the Docker transport, with no network: the source is always mounted read-only.
// Each side is measured as files, bytes, a content digest (sha256 of every regular file, by path) and a metadata digest (path, type, owner, mode, size and
// link targets); a copy is accepted only when all four are equal (`STACK_VOLUME_MISMATCH` otherwise), and `--verify` also measures the source before the
// copy, so a source that changed while it was copied is refused (`STACK_VOLUME_SOURCE_CHANGED`). A copy is refused while any running container or any
// service with tasks to run mounts either volume (`STACK_VOLUME_IN_USE`; a service in standby, 0 replicas, does not count), into a volume the environment
// does not declare (`STACK_VOLUME_UNDECLARED`) and into a volume that is not empty (`STACK_VOLUME_TARGET_NOT_EMPTY`). copy is a dry run until --execute; an
// executed copy is one recorded attempt (kind `volume-copy`) under the deploy lock, its journal keeping both sides' measures. verify changes nothing.
import type { DeployConfig } from './config.mjs';
import { firstLine, lines as splitLines, tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import { recordedAttempt } from './journal.mjs';
import { createReleaseStore } from './release-store.mjs';
import type { ReleaseStore } from './release-store.mjs';
import { ownerSshRunner } from './remote.mjs';
import type { ActionResult, Runner, SshOptions } from './remote.mjs';
import { gateIsOn } from './ssh-gate.mjs';
import { STANDBY_CONSTRAINT } from './standby.mjs';

/** What `stack volume` takes. */
export interface VolumeOptions extends SshOptions {
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  verify?: boolean | undefined;
  execute?: boolean | undefined;
  lockWaitSeconds?: number | undefined;
}

/** The collaborators a caller replaces: the manager's runner and the release store over it (the lock and journal of an executed copy). */
export interface VolumeDeps { ssh?: Runner | undefined; releaseStore?: ((config: DeployConfig, run: Runner) => ReleaseStore) | undefined }

/** One copy: the old volume and the new one. */
export interface VolumePair { from: string; to: string }
/** The measure of one volume. */
export interface VolumeMeasure { files: number; bytes: number; content: string; meta: string }

const VOLUME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const MEASURE = /^files=(\d+) bytes=(\d+) content=([0-9a-f]{64}) meta=([0-9a-f]{64})$/u;

/**
 * The measure of the tree mounted at /v (POSIX sh, BusyBox or GNU tools): the count of regular files, their bytes, the sha256 over every file's sha256 by
 * path, and the sha256 over every entry's path, type, owner and mode, every file's size and every link's target. Directory sizes are left out: they depend on
 * the history of the directory, not on what it holds.
 */
const MEASURE_SCRIPT = [
  'set -e', 'cd /v', 'export LC_ALL=C',
  'files=$(find . -type f | wc -l | tr -d " ")',
  'bytes=$(find . -type f -exec stat -c %s {} + | awk \'{ s += $1 } END { printf "%.0f", s }\')',
  'content=$(find . -type f -exec sha256sum {} + | sort -k2 | sha256sum | cut -d" " -f1)',
  'meta=$({ find . ! -type l -exec stat -c "%n %F %u:%g %a" {} +; find . -type f -exec stat -c "%n size %s" {} +; find . -type l -exec sh -c \'for l; do printf "%s -> %s\\n" "$l" "$(readlink "$l")"; done\' sh {} +; } | sort | sha256sum | cut -d" " -f1)',
  'echo "files=$files bytes=$bytes content=$content meta=$meta"',
].join('; ');

/** The copy: everything under /from, with owners, modes, times and links, into /to. */
const COPY_SCRIPT = 'set -e; cp -a /from/. /to/';
/** Prints the first entry of /v when there is one. */
const EMPTY_SCRIPT = 'find /v -mindepth 1 -maxdepth 1 | head -n 1';

/** `docker run` of the helper image on the manager: no network, root (owners must be kept), the shell as the entrypoint, the mounts given. */
export function helper(ctx: Pick<StackContext, 'spawn'>, image: string, mounts: string[], script: string): { ok: boolean; stdout: string; stderr: string } {
  const run = tool(ctx, 'docker', ['run', '--rm', '--network', 'none', '--user', '0:0', '--entrypoint', 'sh', ...mounts.flatMap((mount) => ['-v', mount]), image, '-c', script]);
  return { ok: run.status === 0 && !run.error, stdout: String(run.stdout ?? ''), stderr: String(run.stderr ?? run.error?.message ?? '') };
}

/** Measures one volume, mounted read-only. */
export function measureVolume(ctx: Pick<StackContext, 'spawn'>, image: string, volume: string): VolumeMeasure {
  const run = helper(ctx, image, [`${volume}:/v:ro`], MEASURE_SCRIPT);
  const found = MEASURE.exec(splitLines(run.stdout).at(-1)?.trim() ?? '');
  if (!run.ok || !found) throw refusal('STACK_VOLUME_MEASURE', `cannot measure the volume ${volume} with ${image}: ${firstLine(run.stderr) || 'no measure printed'}`);
  return { files: Number(found[1]), bytes: Number(found[2]), content: found[3] as string, meta: found[4] as string };
}

/** True when the volume holds nothing. */
export function volumeEmpty(ctx: Pick<StackContext, 'spawn'>, image: string, volume: string): boolean {
  const run = helper(ctx, image, [`${volume}:/v:ro`], EMPTY_SCRIPT);
  if (!run.ok) throw refusal('STACK_VOLUME_MEASURE', `cannot look into the volume ${volume} with ${image}: ${firstLine(run.stderr)}`);
  return run.stdout.trim() === '';
}

/** True when the volume exists on the manager. */
export const volumeExists = (ctx: Pick<StackContext, 'spawn'>, volume: string): boolean => tool(ctx, 'docker', ['volume', 'inspect', volume]).status === 0;

/** What mounts `volume` now: running (or restarting, paused) containers of this host and services with tasks to run. */
export function volumeUsers(ctx: Pick<StackContext, 'spawn'>, volume: string): string[] {
  const users: string[] = [];
  const containers = tool(ctx, 'docker', ['ps', '-a', '--filter', `volume=${volume}`, '--format', '{{.Names}} {{.State}}']);
  if (containers.status !== 0) throw refusal('STACK_VOLUME_IN_USE', `cannot tell which containers mount ${volume}: ${firstLine(containers.stderr)}`);
  for (const line of splitLines(containers.stdout)) {
    const [name, state] = line.split(' ');
    if (state === 'running' || state === 'restarting' || state === 'paused') users.push(`container ${name} (${state})`);
  }
  const ids = tool(ctx, 'docker', ['service', 'ls', '-q']);
  const services = ids.status === 0 ? splitLines(ids.stdout) : [];
  if (services.length === 0) return users;
  const inspected = tool(ctx, 'docker', ['service', 'inspect', '--format', '{{json .Spec}}', ...services]);
  if (inspected.status !== 0) throw refusal('STACK_VOLUME_IN_USE', `cannot tell which services mount ${volume}: ${firstLine(inspected.stderr)}`);
  for (const line of splitLines(inspected.stdout)) {
    // reason: `docker service inspect` JSON, read defensively
    const spec: any = JSON.parse(line);
    const mounts: any[] = spec?.TaskTemplate?.ContainerSpec?.Mounts ?? [];
    if (!mounts.some((mount) => mount?.Type === 'volume' && mount?.Source === volume)) continue;
    const global = spec?.Mode?.Global !== undefined;
    const held = (spec?.TaskTemplate?.Placement?.Constraints ?? []).map((item: string) => item.replaceAll(' ', '')).includes(STANDBY_CONSTRAINT.replaceAll(' ', ''));
    const replicas = Number(spec?.Mode?.Replicated?.Replicas ?? 0);
    if (global ? !held : replicas > 0) users.push(`service ${String(spec?.Name)} (${global ? 'global' : `${replicas} replica(s)`})`);
  }
  return users;
}

/** The volumes the environment declares: `deploy.volumes` and the backup volumes. */
const declaredVolumes = (config: DeployConfig): Set<string> => new Set([...config.volumes, ...(config.backup?.volumes ?? []).map((entry) => entry.volume)]);

/** The pairs of this run: --from and --to, or every pair of `deploy.renamedFrom.volumes`. */
export function volumePairs(config: DeployConfig, options: Pick<VolumeOptions, 'from' | 'to'>): VolumePair[] {
  if ((options.from === undefined) !== (options.to === undefined)) throw refusal('STACK_USAGE', 'stack volume takes --from and --to together, or neither (then the pairs of deploy.renamedFrom.volumes)');
  if (options.from !== undefined && options.to !== undefined) {
    for (const volume of [options.from, options.to]) if (!VOLUME.test(volume)) throw refusal('STACK_USAGE', `${volume} is not a volume name (${VOLUME})`);
    if (options.from === options.to) throw refusal('STACK_USAGE', '--from and --to name the same volume');
    return [{ from: options.from, to: options.to }];
  }
  const map = config.renamedFrom?.volumes;
  if (!map) throw refusal('STACK_VOLUME_PAIRS_UNDECLARED', `name the volumes with --from <volume> --to <volume>, or declare environments.${config.env}.deploy.renamedFrom.volumes`);
  return Object.entries(map).map(([to, from]) => ({ from, to }));
}

const show = (measure: VolumeMeasure): string => `files=${measure.files} bytes=${measure.bytes} content=${measure.content.slice(0, 16)} meta=${measure.meta.slice(0, 16)}`;
const same = (a: VolumeMeasure, b: VolumeMeasure): boolean => a.files === b.files && a.bytes === b.bytes && a.content === b.content && a.meta === b.meta;
const differences = (a: VolumeMeasure, b: VolumeMeasure): string[] => (['files', 'bytes', 'content', 'meta'] as const).filter((key) => a[key] !== b[key]);

/** The helper image: the environment's pinned backup image. */
function helperImage(config: DeployConfig): string {
  if (!config.backup?.image) throw refusal('STACK_VOLUME_NO_IMAGE', `stack volume runs in the pinned backup image: declare environments.${config.env}.deploy.backup (its image is digest-pinned)`);
  return config.backup.image;
}

/** Refuses a pair whose volume is missing or mounted; with `target`, also a target the environment does not declare or that holds data. */
function checkPair(ctx: StackContext, config: DeployConfig, image: string, pair: VolumePair, { target }: { target: boolean }): string[] {
  for (const volume of [pair.from, pair.to]) {
    if (!volumeExists(ctx, volume)) throw refusal('STACK_VOLUME_MISSING', `the volume ${volume} does not exist on the manager${volume === pair.to && target ? ` (stack prepare --env ${config.env} --execute creates the declared volumes)` : ''}; nothing was copied`);
  }
  const users = [pair.from, pair.to].flatMap((volume) => volumeUsers(ctx, volume).map((user) => `${volume}: ${user}`));
  if (users.length > 0) throw refusal('STACK_VOLUME_IN_USE', `${users.join('; ')}: stop what mounts them first (stack standby --env ${config.env}${config.renamedFrom ? ' [--renamed-from]' : ''} --execute); nothing was copied`);
  if (!target) return [`ok    ${pair.from} and ${pair.to} exist and nothing mounts them`];
  if (!declaredVolumes(config).has(pair.to)) throw refusal('STACK_VOLUME_UNDECLARED', `${pair.to} is not a volume environments.${config.env}.deploy declares (volumes or backup.volumes): a copy only fills this environment's own volumes; nothing was copied`);
  if (!volumeEmpty(ctx, image, pair.to)) throw refusal('STACK_VOLUME_TARGET_NOT_EMPTY', `${pair.to} is not empty: a copy fills an empty volume only (remove it and run stack prepare --env ${config.env} --execute to create it empty, once nothing needs what it holds); nothing was copied`);
  return [`ok    ${pair.from} and ${pair.to} exist, nothing mounts them, ${pair.to} is empty and declared`];
}

/** Measures both sides of a pair; the lines and the verdict. */
function comparePair(ctx: StackContext, image: string, pair: VolumePair): { ok: boolean; lines: string[]; record: Record<string, unknown> } {
  const source = measureVolume(ctx, image, pair.from);
  const target = measureVolume(ctx, image, pair.to);
  const ok = same(source, target);
  return {
    ok,
    lines: [`  source ${pair.from}: ${show(source)}`, `  target ${pair.to}: ${show(target)}`, ok ? `  MATCH  ${pair.from} -> ${pair.to}` : `  MISMATCH ${pair.from} -> ${pair.to}: ${differences(source, target).join(', ')} differ`],
    record: { from: pair.from, to: pair.to, source, target, match: ok },
  };
}

/** `volume verify`: measures both sides of every pair and refuses on a difference. Changes nothing. */
function verifyPairs(ctx: StackContext, config: DeployConfig, image: string, pairs: VolumePair[]): ActionResult {
  const lines: string[] = [];
  const records: Record<string, unknown>[] = [];
  for (const pair of pairs) {
    lines.push(...checkPair(ctx, config, image, pair, { target: false }), `volume verify: ${pair.from} -> ${pair.to}`);
    const compared = comparePair(ctx, image, pair);
    lines.push(...compared.lines);
    records.push(compared.record);
  }
  const bad = records.filter((record) => record.match !== true);
  if (bad.length > 0) return { ok: false, refused: { code: 'STACK_VOLUME_MISMATCH', message: `${bad.map((record) => `${String(record.from)} -> ${String(record.to)}`).join(', ')} differ` }, lines, data: { pairs: records } };
  return { ok: true, lines: [...lines, `volume verify: ${pairs.length} pair(s) hold the same tree`], data: { pairs: records } };
}

/** Copies one checked pair and proves it; with `verify` the source is measured before the copy as well. */
function copyPair(ctx: StackContext, image: string, pair: VolumePair, verify: boolean): { ok: boolean; code?: string; lines: string[]; record: Record<string, unknown> } {
  const before = verify ? measureVolume(ctx, image, pair.from) : null;
  const copied = helper(ctx, image, [`${pair.from}:/from:ro`, `${pair.to}:/to`], COPY_SCRIPT);
  if (!copied.ok) return { ok: false, code: 'STACK_VOLUME_COPY_FAILED', lines: [`  FAIL   the copy ${pair.from} -> ${pair.to}: ${firstLine(copied.stderr)}`], record: { from: pair.from, to: pair.to, copied: false } };
  const compared = comparePair(ctx, image, pair);
  if (!compared.ok) return { ok: false, code: 'STACK_VOLUME_MISMATCH', lines: compared.lines, record: compared.record };
  if (before && !same(before, compared.record.source as VolumeMeasure)) {
    return { ok: false, code: 'STACK_VOLUME_SOURCE_CHANGED', lines: [...compared.lines, `  CHANGED ${pair.from} while it was copied: ${differences(before, compared.record.source as VolumeMeasure).join(', ')} differ from the measure taken before`], record: { ...compared.record, before } };
  }
  return { ok: true, lines: [...(before ? [`  before ${pair.from}: ${show(before)} (unchanged by the copy)`] : []), ...compared.lines], record: before ? { ...compared.record, before } : compared.record };
}

/** `stack volume <copy|verify>` (see the header). */
export async function runVolume(ctx: StackContext, config: DeployConfig, options: VolumeOptions = {}, deps: VolumeDeps = {}): Promise<ActionResult> {
  const action = options.action;
  if (action !== 'copy' && action !== 'verify') throw refusal('STACK_USAGE', 'stack volume takes copy or verify');
  if (action === 'verify' && (options.execute === true || options.verify === true)) throw refusal('STACK_USAGE', 'stack volume verify changes nothing: it takes no --execute and no --verify');
  const pairs = volumePairs(config, options);
  const image = helperImage(config);
  if (action === 'verify') return verifyPairs(ctx, config, image, pairs);
  const checked = pairs.flatMap((pair) => checkPair(ctx, config, image, pair, { target: true }));
  if (options.execute !== true) {
    return { ok: true, lines: [...checked, ...pairs.map((pair) => `dry run: would copy ${pair.from} (mounted read-only) into ${pair.to} with ${image}, then compare files, bytes, content and metadata${options.verify ? ', and the source before and after' : ''}`)], data: { pairs, executed: false } };
  }
  const run = deps.ssh ?? ownerSshRunner(ctx, config, { sshCmd: options.sshCmd ?? null });
  try {
    const store = deps.releaseStore ? deps.releaseStore(config, run) : createReleaseStore(config, run, { gated: gateIsOn(ctx.env) });
    return await recordedAttempt(ctx, config, store, { kind: 'volume-copy', trigger: 'dispatch' }, { waitSeconds: options.lockWaitSeconds }, async (rec) => {
      // Checked again under the lock: nothing may have started on either volume since the first look.
      const lines = await rec.phase('check', () => pairs.flatMap((pair) => checkPair(ctx, config, image, pair, { target: true })));
      const records: Record<string, unknown>[] = [];
      for (const pair of pairs) {
        lines.push(`volume copy: ${pair.from} -> ${pair.to}`);
        const done = await rec.phase(`copy-${pair.to}`.slice(0, 80), () => copyPair(ctx, image, pair, options.verify === true), (result) => result.ok);
        lines.push(...done.lines);
        records.push(done.record);
        rec.note({ volumes: records });
        if (!done.ok) return { ok: false, refused: { code: done.code ?? 'STACK_VOLUME_COPY_FAILED', message: `the copy ${pair.from} -> ${pair.to} is not proven; ${pair.from} is untouched (it was mounted read-only) and ${pair.to} must be emptied before another copy` }, lines, data: { pairs: records, executed: true } };
      }
      return { ok: true, lines: [...lines, `volume copy: ${pairs.length} pair(s) copied and proven equal`], data: { pairs: records, executed: true } };
    });
  } finally {
    if (!deps.ssh) run.cleanup?.();
  }
}
