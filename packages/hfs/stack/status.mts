// status.mjs - what runs against what was accepted: `starci app stack status --env <env>` (read-only) compares the live services of the stack with the
// accepted release and prints the drift per service. A service is drifted when
//   - Swarm rolled it back by itself (its update state is `rollback_*`): the release still reads as the new one, the service runs the old spec;
//   - its live image digest is not the digest the release's stack.yaml names, or its task template is not the one observed when the release was accepted
//     (a manual `docker service update`): `updated outside a release`;
//   - it is missing from the swarm, or runs in the stack without being in the release.
// `observedServices(ctx, config)` is the one reader of the live services: the deploy snapshots it into its journal (after converge, after a rollback and on
// accept) and into release.json (`observed`), and `verifyStack` judges the digests it reads. Every call is a docker query; nothing here changes the swarm.
import { createHash } from 'node:crypto';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { canonical } from './converge.mjs';
import type { DeployConfig } from './config.mjs';
import { lines as splitLines, toolOutput } from './context.mjs';
import type { StackContext } from './context.mjs';
import { createReleaseStore } from './release-store.mjs';
import type { ReleaseStore } from './release-store.mjs';
import type { ActionResult, Runner, SshOptions } from './remote.mjs';

/** One live service of the stack as `docker service inspect` reports it (names, digests and states only; no environment, no secret). */
export interface ObservedService {
  /** The service name without the stack prefix (`api` for `shop_api`). */
  service: string;
  /** The image reference of the service spec, or null when it has none. */
  image: string | null;
  /** The `sha256:...` digest the image reference pins, or null when it is a tag only. */
  digest: string | null;
  /** The update state of the service (`completed`, `rollback_completed`, ...), null when it was never updated. */
  updateState: string | null;
  /** The first 16 hex of the sha256 of the canonical task template: it changes when anything a task runs with changes. */
  taskTemplateHash: string | null;
}

/** The kinds of drift a status reports. */
export type DriftKind = 'rolled back by swarm' | 'updated outside a release' | 'missing' | 'not in the release';
/** One service that does not run what the accepted release says. */
export interface ServiceDrift { service: string; kind: DriftKind; detail: string }

const DIGEST = /@(sha256:[0-9a-f]{64})$/u;
const IMAGE_FIELD = /^[A-Za-z0-9][A-Za-z0-9./_:@-]*$/u;

/** The `sha256:...` digest an image reference pins, or null. */
export const digestOf = (image: string | null | undefined): string | null => (image ? (DIGEST.exec(image)?.[1] ?? null) : null);

/** The image of each service of a stack file, by service name (the pinned references of a rendered release). */
export function stackImages(stackYaml: string): Record<string, string> {
  // reason: the stack file, parsed YAML read defensively
  const services: Record<string, any> = parseYaml(stackYaml)?.services ?? {};
  const pairs = Object.entries(services).map(([name, entry]): [string, unknown] => [name, entry?.image]);
  return Object.fromEntries(pairs.filter((pair): pair is [string, string] => typeof pair[1] === 'string' && IMAGE_FIELD.test(pair[1])));
}

const shortDigest = (digest: string | null): string => (digest ? digest.slice(0, 19) : 'no digest');

/** Reads one `docker service inspect` document into an ObservedService. */
function observe(stack: string, name: string, text: string): ObservedService {
  // reason: `docker service inspect` output, parsed JSON read defensively below
  const inspect: any = JSON.parse(text);
  const image: unknown = inspect?.Spec?.TaskTemplate?.ContainerSpec?.Image;
  const template: unknown = inspect?.Spec?.TaskTemplate;
  const state: unknown = inspect?.UpdateStatus?.State;
  const reference = typeof image === 'string' && IMAGE_FIELD.test(image) ? image : null;
  return {
    service: name.startsWith(`${stack}_`) ? name.slice(stack.length + 1) : name,
    image: reference,
    digest: digestOf(reference),
    updateState: typeof state === 'string' && /^[a-z_]+$/u.test(state) ? state : null,
    taskTemplateHash: template === undefined ? null : createHash('sha256').update(canonical(template)).digest('hex').slice(0, 16),
  };
}

/** The live services of the stack, sorted by name. Throws when docker cannot be asked. */
export function observedServices(ctx: Pick<StackContext, 'spawn'>, config: Pick<DeployConfig, 'stack'>): ObservedService[] {
  const names = splitLines(toolOutput(ctx, 'docker', ['service', 'ls', '--filter', `label=com.docker.stack.namespace=${config.stack}`, '--format', '{{.Name}}'])).sort();
  return names.map((name) => observe(config.stack, name, toolOutput(ctx, 'docker', ['service', 'inspect', name, '--format', '{{json .}}'])));
}

/** What a release says its services run: the stack's images and, when it was accepted by this version, the services observed at the accept. */
export interface ExpectedRelease { stackYaml: string; release: Record<string, unknown> }

/** The `observed.accept` services of a release record, or [] when it carries none (an older release). */
function acceptedObservation(release: Record<string, unknown>): ObservedService[] {
  const observed = release.observed as { accept?: unknown } | undefined;
  const list = observed?.accept;
  return Array.isArray(list) ? list.filter((entry): entry is ObservedService => typeof entry === 'object' && entry !== null && typeof (entry as { service?: unknown }).service === 'string') : [];
}

/** Compares the live services with a release; an empty list means they run the release. */
export function compareWithRelease(expected: ExpectedRelease, live: readonly ObservedService[]): ServiceDrift[] {
  const images = stackImages(expected.stackYaml);
  const accepted = new Map(acceptedObservation(expected.release).map((entry) => [entry.service, entry]));
  const running = new Map(live.map((entry) => [entry.service, entry]));
  const drift: ServiceDrift[] = [];
  for (const [service, image] of Object.entries(images)) {
    const now = running.get(service);
    if (!now) { drift.push({ service, kind: 'missing', detail: 'the release names it and no such service runs' }); continue; }
    const wanted = digestOf(image);
    if (now.updateState?.startsWith('rollback')) drift.push({ service, kind: 'rolled back by swarm', detail: `update state ${now.updateState}; runs ${shortDigest(now.digest)}, the release names ${shortDigest(wanted)}` });
    else if (wanted && now.digest !== wanted) drift.push({ service, kind: 'updated outside a release', detail: `runs ${shortDigest(now.digest)}, the release names ${shortDigest(wanted)}` });
    else {
      const seen = accepted.get(service)?.taskTemplateHash ?? null;
      if (seen && now.taskTemplateHash && seen !== now.taskTemplateHash) drift.push({ service, kind: 'updated outside a release', detail: 'its task template changed since the release was accepted' });
    }
  }
  for (const service of running.keys()) if (!Object.hasOwn(images, service)) drift.push({ service, kind: 'not in the release', detail: 'it runs in the stack and the accepted release does not name it' });
  return drift;
}

/** The collaborators of a status (the specs inject stubs). */
export interface StatusDeps {
  ssh: (ctx: StackContext, config: DeployConfig, options: SshOptions) => Runner | Promise<Runner>;
  releaseStore: (config: DeployConfig, ssh: Runner) => ReleaseStore;
  observedServices: (ctx: StackContext, config: DeployConfig) => ObservedService[];
}

// reason: a dynamic import by string, resolved on first use so a spec that injects `ssh` never loads remote.mjs
const ownerSsh = async (ctx: StackContext, config: DeployConfig, options: SshOptions): Promise<Runner> => (await import('./remote.mjs')).ownerSshRunner(ctx, config, options);

const DEFAULT_DEPS: StatusDeps = { ssh: ownerSsh, releaseStore: createReleaseStore, observedServices };

/**
 * `stack status`: the accepted release against the live services. Returns { ok, lines, data: { release, sourceSha, drift, services } }; ok is false exactly
 * when a service drifted. An environment with no accepted release reports that and is not a drift.
 */
export async function statusStack(ctx: StackContext, config: DeployConfig, options: SshOptions = {}, deps: Partial<StatusDeps> = {}): Promise<ActionResult> {
  const d: StatusDeps = { ...DEFAULT_DEPS, ...deps };
  const run = await d.ssh(ctx, config, { sshCmd: options.sshCmd ?? null });
  try {
    const store = d.releaseStore(config, run);
    const current = await store.current();
    const live = d.observedServices(ctx, config);
    if (!current) return { ok: true, lines: [`status: ${config.stack} has no accepted release${live.length > 0 ? `; ${live.length} service(s) run in the stack` : ''}`], data: { release: null, sourceSha: null, drift: [], services: live } };
    const stored = await store.read(current);
    const drift = compareWithRelease(stored, live);
    const sourceSha = typeof stored.release.sourceSha === 'string' ? stored.release.sourceSha : null;
    const drifted = new Map(drift.map((entry) => [entry.service, entry]));
    const names = [...new Set([...Object.keys(stackImages(stored.stackYaml)), ...live.map((entry) => entry.service)])].sort();
    const rows = names.map((name) => {
      const found = drifted.get(name);
      const now = live.find((entry) => entry.service === name);
      return found ? `DRIFT  ${name}  ${found.kind}: ${found.detail}` : `PASS  ${name}  ${shortDigest(now?.digest ?? null)}`;
    });
    const head = `status: accepted release ${current}${sourceSha ? ` (commit ${sourceSha.slice(0, 10)})` : ''}`;
    const tail = drift.length === 0 ? 'status: every service runs the accepted release' : `status: ${drift.length} service(s) differ from the accepted release`;
    return { ok: drift.length === 0, lines: [head, ...rows, tail], data: { release: current, sourceSha, drift, services: live } };
  } finally {
    run.cleanup?.();
  }
}
