// monitoring.mts - the optional monitoring opt-in of a Swarm environment (`environments.<env>.monitoring` of .starcistacks/application-stacks.yaml,
// contexts/project/monitoring.md): what the shared monitoring stack of the server scrapes, probes, keeps and receives from this stack. Absent, nothing here
// runs and the render is byte for byte what it was. Present, the render (render.mts) adds labels, the external monitoring network, exporter sidecars and the
// OpenTelemetry / Pyroscope endpoints from what this module returns. Generic: it names services, ports and kinds of backing service, never an app's words.
import { DEPLOY_CONFIG_CODE } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { refusal } from './errors.mjs';
import type { SecretGrant } from './config.mjs';

/** The network the shared monitoring stack scrapes on when the declaration names none (ops/vps.yaml `monitor.network` of the harness). */
export const MONITORING_NETWORK = 'starci-monitor';
/** Where the shared stack receives OTLP (Alloy, with Tempo on) and profiles (Pyroscope) on that network: `<stack>_<service>` of the harness stack `starci-monitor`. */
export const OTLP_ENDPOINT = 'http://starci-monitor_alloy:4318';
export const PYROSCOPE_ENDPOINT = 'http://starci-monitor_pyroscope:4040';
/** How many probe URLs one environment carries (the shared Prometheus runs one probe job per slot). */
export const PROBE_SLOTS = 10;

/**
 * The exporters of backing services. A native kind is scraped on the service itself (its default port and path); a sidecar kind runs an exporter
 * service beside it, pinned by digest (resolved 2026-11-20 with `docker buildx imagetools inspect`), on the service's networks and the monitoring one.
 */
export const EXPORTER_KINDS = {
  postgres: { sidecar: true, port: 5432, metricsPort: 9187, image: 'prometheuscommunity/postgres-exporter:v0.20.1@sha256:ac5ec343104fae0e2d84a27bb8d69b38430a11910c5382cad85d478d2bab713e' },
  redis: { sidecar: true, port: 6379, metricsPort: 9121, image: 'oliver006/redis_exporter:v1.96.0@sha256:3d57b9eb142a62ffc600063606a41cd471cd53d81bed10be5b56b3a8918f2c26' },
  minio: { sidecar: false, port: 9000, path: '/minio/v2/metrics/cluster', environment: { MINIO_PROMETHEUS_AUTH_TYPE: 'public' } },
  qdrant: { sidecar: false, port: 6333, path: '/metrics' },
  'kafka-connect': { sidecar: false, port: 9404, path: '/metrics' },
  ingress: { sidecar: false, port: null, path: '/metrics' },
} as const;
export type ExporterKind = keyof typeof EXPORTER_KINDS;

/** One stack service the shared Prometheus scrapes: the port it serves metrics on inside the stack and the path. */
export interface MetricsTarget { service: string; port: number; path: string; environment?: Record<string, string> }
/** An exporter sidecar the render adds: its name, kind, the service it reads, and the sealed key of its password (postgres). */
export interface ExporterSidecar { name: string; kind: 'postgres' | 'redis'; target: string; port: number; database: string; user: string; password: { member: string; key: string } | null }
/** The normalised opt-in. */
export interface MonitoringOptIn {
  network: string;
  logs: boolean;
  /** Every scraped service (metrics and native exporters): one port and path per service. */
  metrics: MetricsTarget[];
  sidecars: ExporterSidecar[];
  /** The probe URLs and the service that carries their labels (null when there is none). */
  probes: string[];
  probeCarrier: string | null;
  /** The services that send traces (OTLP) and profiles: `true` is every `metrics` service, a list names them. */
  traces: string[];
  profiles: string[];
}

const NETWORK = /^[a-z][a-z0-9_-]*$/u;
const PATH = /^\/\S*$/u;
const URL_FORM = /^https?:\/\/[^\s"'`]+$/u;
const validPort = (port: unknown): boolean => Number.isInteger(port) && Number(port) > 0 && Number(port) < 65536;

// reason: the declaration is parsed YAML, judged here
type Parsed = any;

/** The public hosts the environment's ingress declares: an own or external ingress's `hosts`, a shared edge's route hosts. */
const ingressHosts = (ingress: Parsed): string[] => {
  const routes = Array.isArray(ingress?.routes) ? ingress.routes.map((route: Parsed) => String(route?.host ?? '')) : [];
  const hosts = Array.isArray(ingress?.hosts) ? ingress.hosts.map(String) : [];
  return [...new Set([...hosts, ...routes].filter((host) => /^[a-z0-9.-]+$/u.test(host)))];
};

/** The service that carries the probe labels: the own ingress component, else the first shared-edge route's service, else the first scraped service. */
const carrierOf = (ingress: Parsed, services: Set<string>, metrics: MetricsTarget[]): string | null => {
  const own = typeof ingress?.component === 'string' && services.has(ingress.component) ? ingress.component : null;
  const routed = Array.isArray(ingress?.routes) ? ingress.routes.map((route: Parsed) => String(route?.service ?? '')).find((service: string) => services.has(service)) ?? null : null;
  return own ?? routed ?? metrics[0]?.service ?? null;
};

/**
 * The monitoring opt-in of an environment, refused (STACKS_DEPLOY_CONFIG_INVALID) naming every problem; null when it declares none. `backing` is the
 * declaration's `backing` block: a postgres exporter without a service reads the backing postgres component.
 */
export function monitoringOf(environment: Parsed, context: { services: Set<string>; members: Set<string>; backing: Parsed; env: string }): MonitoringOptIn | null {
  const block = environment?.monitoring;
  if (block === undefined || block === null) return null;
  const { services, members, backing, env } = context;
  const problems: string[] = [];
  if (typeof block !== 'object' || Array.isArray(block)) throw refusal(DEPLOY_CONFIG_CODE, `environments.${env}.monitoring is not a mapping`);
  const network = block.network === undefined ? MONITORING_NETWORK : block.network;
  if (typeof network !== 'string' || !NETWORK.test(network)) problems.push('network is not a network name');
  if (block.logs !== undefined && typeof block.logs !== 'boolean') problems.push('logs is not true or false');
  const scraped = new Set<string>();
  const metrics: MetricsTarget[] = [];
  const scrape = (where: string, service: string, port: unknown, path: unknown, environment?: Record<string, string>): void => {
    if (!services.has(service)) problems.push(`${where} names the service ${service}, which the stack file does not hold`);
    if (scraped.has(service)) problems.push(`${where} names the service ${service} a second time: one metrics port per service`);
    if (!validPort(port)) problems.push(`${where} of ${service} has no valid port`);
    if (typeof path !== 'string' || !PATH.test(path)) problems.push(`${where} of ${service} has a path that is not absolute`);
    scraped.add(service);
    metrics.push({ service, port: Number(port), path: String(path), ...(environment === undefined ? {} : { environment }) });
  };
  for (const entry of Array.isArray(block.metrics) ? block.metrics : []) scrape('metrics', String(entry?.service ?? ''), entry?.port, entry?.path ?? '/metrics');
  const sidecars: ExporterSidecar[] = [];
  const backingPostgres = Object.values(backing ?? {}).map((entry: Parsed) => (entry?.provider === 'postgres' ? String(entry?.component ?? '') : '')).find((component) => component !== '');
  for (const entry of Array.isArray(block.exporters) ? block.exporters : []) {
    const kind = String(entry?.kind ?? '') as ExporterKind;
    const spec = EXPORTER_KINDS[kind];
    if (spec === undefined) { problems.push(`exporters names the kind ${kind}; the kinds are ${Object.keys(EXPORTER_KINDS).join(', ')}`); continue; }
    const service = String(entry?.service ?? (kind === 'postgres' ? backingPostgres ?? '' : ''));
    if (!spec.sidecar) { scrape(`exporters (${kind})`, service, entry?.port ?? spec.port, entry?.path ?? spec.path, 'environment' in spec ? { ...spec.environment } : undefined); continue; }
    if (!services.has(service)) problems.push(`exporters (${kind}) names the service ${service || '(none)'}, which the stack file does not hold`);
    const port = entry?.port ?? spec.port;
    if (!validPort(port)) problems.push(`exporters (${kind}) of ${service} has no valid port`);
    const password = entry?.password === undefined ? null : { member: String(entry.password?.member ?? ''), key: String(entry.password?.key ?? '') };
    if (password !== null && (!members.has(password.member) || !/^[A-Z][A-Z0-9_]*$/u.test(password.key))) problems.push(`exporters (${kind}) of ${service}: password names the sealed member ${password.member} and a KEY of it; the member is not sealed or the key is no key name`);
    if (kind === 'postgres' && password === null) problems.push(`exporters (postgres) of ${service} needs password: {member, key}, the sealed password of its read-only monitoring role`);
    if (kind === 'redis' && password !== null) problems.push(`exporters (redis) of ${service}: a password is not supported yet; scrape a Redis that its private network alone guards`);
    sidecars.push({ name: `${service}-${kind}-exporter`, kind: kind === "postgres" ? "postgres" : "redis", target: service, port: Number(port), database: String(entry?.database ?? 'postgres'), user: String(entry?.user ?? 'postgres'), password });
  }
  for (const sidecar of sidecars) if (services.has(sidecar.name)) problems.push(`the exporter ${sidecar.name} has the name of a stack service`);
  let probes: string[] = [];
  if (block.probes === undefined) probes = ingressHosts(environment?.ingress).map((host) => `https://${host}/`);
  else if (Array.isArray(block.probes)) probes = block.probes.map(String);
  else if (block.probes !== false) problems.push('probes is false or a list of http(s) URLs');
  for (const url of probes) if (!URL_FORM.test(url)) problems.push(`probes holds ${JSON.stringify(url)}, which is no http(s) URL`);
  if (probes.length > PROBE_SLOTS) problems.push(`probes holds ${probes.length} URLs; at most ${PROBE_SLOTS}`);
  const probeCarrier = probes.length === 0 ? null : carrierOf(environment?.ingress, services, metrics);
  if (probes.length > 0 && probeCarrier === null) problems.push('probes need a service to carry their labels: an ingress component, a shared-edge route or a metrics service');
  if (problems.length > 0) throw refusal(DEPLOY_CONFIG_CODE, `environments.${env}.monitoring: ${problems.slice(0, 6).join('; ')}`);
  const instrumented = (Array.isArray(block.metrics) ? block.metrics : []).map((entry: Parsed) => String(entry?.service ?? ''));
  const telemetry = (flag: 'traces' | 'profiles'): string[] => {
    const value = block[flag];
    if (value === undefined || value === false) return [];
    if (value === true) return instrumented;
    if (Array.isArray(value)) {
      for (const service of value.map(String)) if (!services.has(service)) problems.push(`${flag} names the service ${service}, which the stack file does not hold`);
      return value.map(String);
    }
    problems.push(`${flag} is true, false or a list of services`);
    return [];
  };
  const traces = telemetry('traces'), profiles = telemetry('profiles');
  if (problems.length > 0) throw refusal(DEPLOY_CONFIG_CODE, `environments.${env}.monitoring: ${problems.slice(0, 6).join('; ')}`);
  return { network: String(network), logs: block.logs !== false, metrics, sidecars, probes, probeCarrier, traces, profiles };
}

/** The secret grants of the exporter sidecars: each password key mounted as a file (no `_FILE` pointer; the sidecar's environment names it). */
export const sidecarGrants = (monitoring: MonitoringOptIn | null): SecretGrant[] =>
  (monitoring?.sidecars ?? []).flatMap((sidecar) => (sidecar.password === null ? [] : [{ service: sidecar.name, filePointers: false, from: [{ member: sidecar.password.member, keys: [sidecar.password.key], required: true, fill: false }] }]));

/** The deploy labels of a scraped service and of the probe carrier; nothing for any other service. */
export function monitoringDeployLabels(monitoring: MonitoringOptIn, service: string, stack: string): string[] {
  const target = monitoring.metrics.find((entry) => entry.service === service);
  const scrape = target === undefined ? [] : ['starci.monitor.scrape=true', `starci.monitor.port=${String(target.port)}`, `starci.monitor.path=${target.path}`];
  const probes = monitoring.probeCarrier === service ? monitoring.probes.map((url, slot) => `starci.monitor.probe.${String(slot)}=${url}`) : [];
  return scrape.length + probes.length === 0 ? [] : [...scrape, ...probes, `starci.monitor.stack=${stack}`];
}

/** The environment a traced or profiled service gets: the OTLP endpoint and service name, the Pyroscope server and application name. */
export function telemetryEnvironment(monitoring: MonitoringOptIn, service: string, stack: string, env: string): Record<string, string> {
  return {
    ...(monitoring.traces.includes(service) ? { OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_SERVICE_NAME: `${stack}-${service}`, OTEL_RESOURCE_ATTRIBUTES: `deployment.environment=${env}` } : {}),
    ...(monitoring.profiles.includes(service) ? { PYROSCOPE_SERVER_ADDRESS: PYROSCOPE_ENDPOINT, PYROSCOPE_APPLICATION_NAME: `${stack}.${service}` } : {}),
  };
}

/** The services that send traces or profiles to the shared stack. */
export function telemetryServices(monitoring: MonitoringOptIn): string[] {
  return [...new Set([...monitoring.traces, ...monitoring.profiles])];
}

/**
 * The full service of an exporter sidecar: pinned image, its target's networks and placement plus the monitoring network, the scrape labels, limits
 * and a rollback-on-failure rollout; the password arrives through the sealed grant (render.mts adds its `secrets`).
 */
export function sidecarService(sidecar: ExporterSidecar, monitoring: MonitoringOptIn, stack: string, source: Parsed): Record<string, unknown> {
  const spec = EXPORTER_KINDS[sidecar.kind];
  const target = source?.services?.[sidecar.target] ?? {};
  const networks = Array.isArray(target.networks) ? target.networks.map(String) : target.networks !== undefined && typeof target.networks === 'object' ? Object.keys(target.networks) : ['default'];
  const constraints = Array.isArray(target?.deploy?.placement?.constraints) ? target.deploy.placement.constraints : ['node.role == manager'];
  const environment = sidecar.kind === 'postgres'
    ? { DATA_SOURCE_URI: `${sidecar.target}:${String(sidecar.port)}/${sidecar.database}?sslmode=disable`, DATA_SOURCE_USER: sidecar.user, ...(sidecar.password === null ? {} : { DATA_SOURCE_PASS_FILE: `/run/secrets/${sidecar.password.key}` }) }
    : { REDIS_ADDR: `redis://${sidecar.target}:${String(sidecar.port)}` };
  return {
    image: spec.image,
    environment,
    networks: [...new Set([...networks, monitoring.network])],
    ...(sidecar.kind === 'postgres' ? { healthcheck: { test: ['CMD', 'wget', '-q', '-O', '/dev/null', `http://127.0.0.1:${String(spec.metricsPort)}/metrics`], interval: '30s', timeout: '5s', retries: 3, start_period: '20s' } } : {}),
    deploy: {
      replicas: 1,
      placement: { constraints },
      labels: ['starci.monitor.scrape=true', `starci.monitor.port=${String(spec.metricsPort)}`, 'starci.monitor.path=/metrics', `starci.monitor.stack=${stack}`],
      resources: { limits: { memory: '64M', cpus: '0.10' }, reservations: { memory: '16M', cpus: '0.02' } },
      update_config: { parallelism: 1, order: 'start-first', failure_action: 'rollback', monitor: '30s' },
      rollback_config: { parallelism: 1, order: 'start-first' },
      restart_policy: { condition: 'on-failure', delay: '5s' },
    },
  };
}
