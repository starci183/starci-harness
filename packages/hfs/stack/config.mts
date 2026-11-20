// config.mts - loads `environments.<env>.deploy` of .starcistacks/application-stacks.yaml for the stack verbs.
// The block is read and judged by the same module `starci app check` uses (runtime/scripts/hfs/stack-deploy-config.mts).
import fs from 'node:fs';
import { isSealedName, memberOfName } from '../runtime/scripts/lib/sealed-member.mjs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { DEPLOY_CONFIG_CODE, NAME, normalizeDeploy, type RenamedFrom, type SealedRoles } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
export type { RenamedFrom } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { refusal } from './errors.mjs';
import type { TargetBinding } from './target-binding.mjs';
import { monitoringOf, sidecarGrants } from './monitoring.mjs';
import type { MonitoringOptIn } from './monitoring.mjs';
export type { MonitoringOptIn } from './monitoring.mjs';

/** The sealed SSH roles of `deploy.remote.sealed`: the member that holds each. */
export type SealedRemote = SealedRoles;
export interface DeployRemote { host: string; releasesBase: string | null; sealed: SealedRemote | null; serverRecipient: string | null }
export interface BuildArgsSealed { member: string; keys: string[] }
export interface BuildArgsBlock { values: Record<string, string>; sealed: BuildArgsSealed | null }
export interface ImageEntry { app: string; buildArgs: BuildArgsBlock }
export interface SecretSource { member: string; keys: string[] | null; required: boolean; fill: boolean }
export interface SecretGrant { service: string; filePointers: boolean; from: SecretSource[] }
export interface SecretSetting { member: string; keys: string[] }
export interface EnvironmentSetting { key: string; default: string | null }
export interface ServiceEnvironment { files: string[]; values: Record<string, string>; settings: Record<string, EnvironmentSetting> }
export interface ConfigEntry { name: string; file: string; env: string }
export interface HttpCheck {
  name: string; url: string; method: string; body: unknown; status: number; json: Record<string, unknown> | null; contains: unknown; retry: boolean;
}
export interface ExecCheck { name: string; service: string; command: string[]; stdout: string | null }
export interface JobsBlock { service: string; command: string[] }
export interface TaskEntry { service: string; command: string[]; timeoutSeconds: number }
export interface BackupVolume { name: string; volume: string }
export interface BackupBlock { image: string; keepDays: number; dir: string | null; volumes: BackupVolume[] }
/** The normalised `deploy.notify` block: the sealed webhook URL and the outcomes announced. */
export interface NotifyBlock { webhook: { member: string; key: string }; on: string[] }
export interface RegistryBlock { host: string; visibility: string }

export interface IngressLegacy { dir: string; dynamicDir: string; container: string }
export interface IngressUpstream {
  name: string; hosts: string[]; container: string | null; hostAddress: string | null; port: number; aliases: string[]; middlewares: string[];
}
export interface IngressVerify { host: string; path: string; status: number | null }
export interface IngressRedirect { host: string; to: string; status: number }
export interface IngressPublish { file: string; supersedes: string[] }
export interface RehearsalPorts { http: number; https: number }
export interface IngressTakeover { gateSeconds: number; rehearsalPorts: RehearsalPorts }
/** The normalised `deploy.ingress` block (stack-ingress-config.mts). */
export interface IngressConfig {
  name: string;
  image: string | null;
  args: string[] | null;
  service: string;
  network: string;
  acmeVolume: string;
  legacy: IngressLegacy;
  upstreams: IngressUpstream[];
  routes: string | null;
  middlewares: Record<string, Record<string, unknown>>;
  verify: IngressVerify[];
  drop: string[];
  redirects: IngressRedirect[];
  backup: { dir: string } | null;
  publish: IngressPublish | null;
  takeover: IngressTakeover;
}

/** The normalised `deploy` block of one environment (stack-deploy-config.mts). */
export interface DeployBlock {
  stack: string;
  remote: DeployRemote;
  images: Record<string, ImageEntry>;
  volumes: string[];
  secrets: { grants: SecretGrant[]; settings: SecretSetting[] };
  environment: Record<string, ServiceEnvironment>;
  configs: ConfigEntry[];
  passEnv: string[];
  /** deploy.auto: a green release tag deploys here by itself (the CI workflow reads it; the verbs do not). */
  auto: boolean;
  /** deploy.approval: none, or reviewers set on the GitHub Environment. */
  approval: 'none' | 'reviewers';
  /** deploy.platforms: the platforms the images are built for (default linux/amd64). */
  platforms: string[];
  verify: { http: HttpCheck[]; exec: ExecCheck[] };
  jobs: JobsBlock | null;
  tasks: Record<string, TaskEntry>;
  postDeploy: string[];
  backup: BackupBlock | null;
  notify: NotifyBlock | null;
  ingress: IngressConfig | null;
  registry: RegistryBlock;
  /** deploy.renamedFrom (PROJECT-STACKS-18): the old stack, its releases base and the volume map new -> old; absent unless declared. */
  renamedFrom?: RenamedFrom | undefined;
}

/** One public host of a shared edge: the stack service that serves it and the port that service listens on, optionally only for some paths (exact `paths`, `pathPrefixes`) and with an explicit router `priority`. */
export interface EdgeRoute { host: string; service: string; port: number; paths: string[]; pathPrefixes: string[]; priority: number | null }
/** The shared edge-traefik declaration (`environments.<env>.ingress` with `kind: shared-edge`) the render turns into router labels. */
export interface SharedEdge { network: string; certResolver: string; entrypoint: string; routes: EdgeRoute[] }
/** The deploy configuration of one environment, with absolute paths. */
export interface DeployConfig extends DeployBlock {
  env: string;
  project: string;
  repoRoot: string;
  envDir: string;
  stackFile: string;
  secretsDir: string;
  members: Set<string>;
  services: Set<string>;
  /** Set by bindStackTarget when a native consumer bound the target. */
  nativeTarget?: Readonly<TargetBinding> | undefined;
  /** The shared edge ingress declaration, or null for an own or external ingress. */
  edge?: SharedEdge | null | undefined;
  /** The monitoring opt-in, or null when the environment declares none (the render is then exactly what it was without it). */
  monitoring?: MonitoringOptIn | null | undefined;
}

export const STACKS_DIR = '.starcistacks';
export const STACKS_FILE = 'application-stacks.yaml';

/** Read a YAML input, refusing with a stack error naming its purpose when it is missing or invalid. */
// reason: parsed YAML from disk, its shape is judged by the callers
export const readYaml = (file: string, what: string): any => {
  let source: string;
  try { source = fs.readFileSync(file, 'utf8'); } catch { throw refusal('STACKS_DEPLOY_FILE_MISSING', `${what} (${file}) is not readable`); }
  try { return parseYaml(source); } catch { throw refusal('STACKS_DEPLOY_FILE_INVALID', `${what} is not valid YAML`); }
};

const projectOf = (repoRoot: string): string => {
  const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hfs.json'), 'utf8'));
  return String(doc.project);
};

const sealedMembers = (secretsDir: string): Set<string> => {
  try { return new Set(fs.readdirSync(secretsDir).filter(isSealedName).map(memberOfName)); } catch { return new Set(); }
};

const stackServices = (stackFile: string): Set<string> => {
  const model = readYaml(stackFile, 'the stack source');
  return new Set(Object.keys(model?.services ?? {}));
};

const ABSOLUTE_PATH = /^\/[^\s`]*$/u;
const pathList = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => String(item)) : []);

/** The shared edge declaration of an environment, refused when it names a service the stack file does not hold; null for any other ingress form. */
// reason: the ingress block is parsed YAML, judged here
export function edgeOf(ingress: any, services: Set<string>, env: string): SharedEdge | null {
  if (ingress?.kind !== 'shared-edge') return null;
  const routes: EdgeRoute[] = (Array.isArray(ingress.routes) ? ingress.routes : []).map((route: any) => ({ host: String(route?.host ?? '').toLowerCase(), service: String(route?.service ?? ''), port: Number(route?.port), paths: pathList(route?.paths), pathPrefixes: pathList(route?.pathPrefixes), priority: Number.isInteger(route?.priority) ? Number(route.priority) : null }));
  const validPort = (port: number): boolean => Number.isInteger(port) && port > 0 && port < 65536;
  const problems = [
    ...(routes.length === 0 ? ['no routes'] : []),
    ...routes.flatMap((route) => [
      ...(services.has(route.service) ? [] : [`route ${route.host} names the service ${route.service}, which the stack file does not hold`]),
      ...(validPort(route.port) ? [] : [`route ${route.host} has no valid port`]),
      ...(/^[a-z0-9.-]+$/u.test(route.host) ? [] : [`route host ${JSON.stringify(route.host)} is not a hostname`]),
      ...[...route.paths, ...route.pathPrefixes].filter((value) => !ABSOLUTE_PATH.test(value)).map((value) => `route ${route.host} has the path ${JSON.stringify(value)}, which is not an absolute path`),
    ]),
    ...(typeof ingress.network === 'string' && ingress.network !== '' ? [] : ['no network']),
    ...(typeof ingress.certResolver === 'string' && ingress.certResolver !== '' ? [] : ['no certResolver']),
  ];
  if (problems.length > 0) throw refusal(DEPLOY_CONFIG_CODE, `environments.${env}.ingress (shared-edge): ${problems.slice(0, 6).join('; ')}`);
  return { network: ingress.network, certResolver: ingress.certResolver, entrypoint: typeof ingress.entrypoint === 'string' && ingress.entrypoint !== '' ? ingress.entrypoint : 'websecure', routes };
}

/**
 * The normalised deploy configuration of one environment, with absolute paths:
 *   { env, project, stack, repoRoot, envDir, stackFile, secretsDir, members, services, ...deploy block }.
 * Throws StackError (exit 2) naming every problem when the block is missing or invalid.
 */
export function loadDeployConfig({ repoRoot, env }: { repoRoot: string; env: string }): DeployConfig {
  if (!NAME.test(String(env))) throw refusal(DEPLOY_CONFIG_CODE, `--env ${env} must match ${NAME}`);
  const declaration = readYaml(path.join(repoRoot, STACKS_DIR, STACKS_FILE), STACKS_FILE);
  const environment = declaration?.environments?.[env];
  if (!environment) throw refusal('STACKS_DEPLOY_ENV_UNKNOWN', `${STACKS_FILE} declares no environment ${env}`);
  if (environment.runtime !== 'docker-swarm') throw refusal('STACKS_DEPLOY_NOT_SWARM', `environment ${env} runs ${environment.runtime}; stack deploy verbs need docker-swarm`);
  if (environment.deploy === undefined) throw refusal('STACKS_DEPLOY_UNDECLARED', `environment ${env} has no deploy block in ${STACKS_FILE}`);
  const envDir = path.join(repoRoot, STACKS_DIR, env);
  const stackFile = path.join(envDir, String(environment.composeFiles?.[0] ?? ''));
  const secretsDir = path.join(envDir, 'secrets');
  const services = stackServices(stackFile);
  const members = sealedMembers(secretsDir);
  const probe = { exists: (rel: string) => fs.existsSync(path.join(envDir, rel)), services, members };
  const project = projectOf(repoRoot);
  const { config, problems } = normalizeDeploy(environment.deploy, { project, probe });
  if (!config) {
    const first = problems.slice(0, 6).map((item: { at: string; message: string }) => `${item.at}: ${item.message}`).join('; ');
    throw refusal(DEPLOY_CONFIG_CODE, `${problems.length} problem${problems.length === 1 ? '' : 's'} in environments.${env}.deploy: ${first}`);
  }
  const monitoring = monitoringOf(environment, { services, members, backing: declaration?.backing, env });
  const grants = sidecarGrants(monitoring);
  return { env, project, repoRoot, envDir, stackFile, secretsDir, members, services, edge: edgeOf(environment.ingress, services, env), monitoring, ...config, ...(grants.length === 0 ? {} : { secrets: { ...config.secrets, grants: [...config.secrets.grants, ...grants] } }) };
}
