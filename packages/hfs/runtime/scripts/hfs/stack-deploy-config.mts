// stack-deploy-config.mjs - the ONE reader of `environments.<env>.deploy` in .starcistacks/application-stacks.yaml (R294).
// `starci app stack ...` (packages/hfs/stack) normalises the block through it and `starci app check` (rules/stacks-deploy.mjs)
// judges the same block through it, so the verbs and the rule can never disagree. Pure given the block and a probe of the app tree.
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { closedFields, collector, patternField, treeFile, type Collector, type StackProblem, type TreeProbe } from './stack-config-kit.mjs';
import { list } from '../lib/list.mjs';
import { normalizeIngress, type IngressConfig } from './stack-ingress-config.mjs';

// reason: a parsed YAML block; closedFields checks its key set and every value is validated field by field.
type Block = any;

/** What the caller knows of the app tree: file presence below .starcistacks/<env>/, the stack's services and the sealed members. */
export interface DeployProbe extends TreeProbe { services?: Set<string>; members?: Set<string> }

/** The sealed SSH roles of `deploy.remote.sealed`: the member that holds each. */
export interface SealedRoles { ops: string; sshKey: string; knownHosts: string }
export interface RemoteConfig { host: string; releasesBase: string | null; sealed: SealedRoles | null; serverRecipient: string | null }
export interface ImageBuildArgs { values: Record<string, string>; sealed: { member: string; keys: string[] } | null }
export interface ImageEntry { app: string; buildArgs: ImageBuildArgs }
export interface SourceEntry { member: string; keys: string[] | null; required: boolean; fill: boolean }
export interface GrantEntry { service: string; filePointers: boolean; from: SourceEntry[] }
export interface SettingsEntry { member: string; keys: string[] }
export interface SecretsConfig { grants: GrantEntry[]; settings: SettingsEntry[] }
export interface ServiceEnvironment { files: string[]; values: Record<string, string>; settings: Record<string, { key: string; default: string | null }> }
export interface ConfigEntry { name: string; file: string; env: string }
export interface HttpCheck { name: string; url: string; method: string; body: unknown; status: number; json: Record<string, unknown> | null; contains: unknown; retry: boolean }
export interface ExecCheck { name: string; service: string; command: string[]; stdout: string | null }
export interface VerifyConfig { http: HttpCheck[]; exec: ExecCheck[] }
export interface JobsConfig { service: string; command: string[] }
export interface TaskConfig { service: string; command: string[]; timeoutSeconds: number }
export interface BackupConfig { image: string; keepDays: number; dir: string | null; volumes: Array<{ name: string; volume: string }> }
/** The outcomes of a deploy attempt a notification can be sent for. */
export const NOTIFY_OUTCOMES = ['accepted', 'rolled-back', 'rollback-failed', 'failed', 'refused'] as const;
/** `deploy.notify`: the sealed member and key that hold the webhook URL (https), and the outcomes that are announced. */
export interface NotifyConfig { webhook: { member: string; key: string }; on: string[] }
export interface RegistryConfig { host: string; visibility: string }

/** The normalised `deploy` block. */
export interface DeployConfig {
  stack: string;
  remote: RemoteConfig;
  images: Record<string, ImageEntry>;
  volumes: string[];
  secrets: SecretsConfig;
  environment: Record<string, ServiceEnvironment>;
  configs: ConfigEntry[];
  passEnv: string[];
  /** deploy.auto: a green release tag deploys here by itself. */
  auto: boolean;
  /** deploy.approval: none, or reviewers set on the GitHub Environment. */
  approval: 'none' | 'reviewers';
  /** deploy.platforms: the platforms the images are built for (default linux/amd64). */
  platforms: string[];
  verify: VerifyConfig;
  jobs: JobsConfig | null;
  tasks: Record<string, TaskConfig>;
  postDeploy: string[];
  backup: BackupConfig | null;
  /** deploy.notify: one webhook message per deploy outcome; null (off) unless declared. */
  notify: NotifyConfig | null;
  ingress: IngressConfig | null;
  registry: RegistryConfig;
}

/** What `normalizeDeploy` returns: the config (null when a problem was found) and every problem. */
export interface DeployResult { config: DeployConfig | null; problems: StackProblem[] }

/** One component-to-app tie of a stack declaration. */
export interface DeployImageTie { environment: string; service: string; app: string }

export const DEPLOY_CONFIG_CODE = 'STACKS_DEPLOY_CONFIG_INVALID';

export const NAME = /^[a-z][a-z0-9-]*$/u;
export const KEY = /^[A-Z][A-Z0-9_]*$/u;
const VOLUME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const HOST_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const REMOTE_BASE = /^\/[A-Za-z0-9._/-]+$/u;
const AGE_RECIPIENT = /^age1[a-z0-9]+$/u;
const HTTP_URL = /^https?:\/\/[^\s]+$/u;
const PINNED_HELPER_IMAGE = /^[a-z0-9./_-]+(?::[A-Za-z0-9._-]+)?@sha256:(?!0{64}$)[0-9a-f]{64}$/u;
const ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const UPPER_ENV = KEY;

const FIELDS = {
  deploy: ['stack', 'remote', 'images', 'volumes', 'secrets', 'environment', 'configs', 'passEnv', 'auto', 'approval', 'platforms', 'postDeploy', 'verify', 'jobs', 'tasks', 'backup', 'notify', 'ingress', 'registry'],
  remote: ['host', 'releasesBase', 'sealed', 'serverRecipient'],
  image: ['app', 'buildArgs'],
  buildArgs: ['values', 'sealed'],
  secrets: ['grants', 'settings'],
  grant: ['service', 'filePointers', 'from'],
  source: ['member', 'keys', 'required', 'fill'],
  settings: ['member', 'keys'],
  environment: ['files', 'values', 'settings'],
  setting: ['key', 'default'],
  config: ['name', 'file', 'env'],
  verify: ['http', 'exec'],
  http: ['name', 'url', 'method', 'body', 'status', 'json', 'contains', 'retry'],
  exec: ['name', 'service', 'command', 'stdout'],
  jobs: ['service', 'command'],
  task: ['service', 'command', 'timeoutSeconds'],
  backup: ['image', 'keepDays', 'dir', 'volumes'],
  backupVolume: ['name', 'volume'],
  registry: ['host', 'visibility'],
  notify: ['webhook', 'on'],
  webhook: ['member', 'key'],
};

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const APPROVALS = ['none', 'reviewers'];
const PLATFORMS = ['linux/amd64', 'linux/arm64'];

function flag(c: Collector, at: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') c.problem(at, 'must be true or false');
  return value === true;
}

function choice(c: Collector, at: string, value: unknown, allowed: readonly string[], fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) { c.problem(at, `must be one of ${allowed.join(', ')}`); return fallback; }
  return value;
}

/** `deploy.platforms`: the platforms the images are built for, default linux/amd64 (the VPS's architecture). */
function platforms(c: Collector, value: unknown): string[] {
  if (value === undefined) return ['linux/amd64'];
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length || value.some((item) => typeof item !== 'string' || !PLATFORMS.includes(item))) {
    c.problem('deploy.platforms', `must be a list of ${PLATFORMS.join(' and ')}, each once`);
    return ['linux/amd64'];
  }
  return value as string[];
}

const nameField = (c: Collector, at: string, value: unknown, pattern: RegExp = NAME): boolean => patternField(c, at, value, pattern);

function stringList(c: Collector, at: string, value: unknown, itemPattern: RegExp, { nonEmpty = false }: { nonEmpty?: boolean } = {}): string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) { c.problem(at, 'must be a list'); return []; }
  value.forEach((item: unknown, index: number) => { if (typeof item !== 'string' || !itemPattern.test(item)) c.problem(`${at}[${index}]`, `must match ${itemPattern}`); });
  return value;
}

/**
 * `deploy.remote`: the ssh alias, the releases root, the sealed owner-machine session and `serverRecipient`, the public age
 * recipient of the server's own identity that `starci app secret server-key` records.
 */
function remote(c: Collector, block: Block): RemoteConfig {
  const fallback: RemoteConfig = { host: 'vps', releasesBase: null, sealed: null, serverRecipient: null };
  if (block === undefined) return fallback;
  if (!closedFields(c, 'deploy.remote', block, FIELDS.remote)) return fallback;
  if (block.serverRecipient !== undefined) patternField(c, 'deploy.remote.serverRecipient', block.serverRecipient, AGE_RECIPIENT);
  if (block.host !== undefined) nameField(c, 'deploy.remote.host', block.host, HOST_ALIAS);
  if (block.releasesBase !== undefined && (!REMOTE_BASE.test(String(block.releasesBase)) || String(block.releasesBase).includes('..')))
    c.problem('deploy.remote.releasesBase', 'must be an absolute path without ..');
  let sealed: SealedRoles | null = null;
  // One member holds VPS_HOST, VPS_USER, privateKey and knownHosts (`sealed: vps`); it plays all three SSH roles of the transport.
  if (typeof block.sealed === 'string') {
    nameField(c, 'deploy.remote.sealed', block.sealed);
    const member: string = block.sealed;
    sealed = { ops: member, sshKey: member, knownHosts: member };
  } else if (block.sealed !== undefined) {
    c.problem('deploy.remote.sealed', 'names one member holding VPS_HOST, VPS_USER, privateKey and knownHosts (sealed: vps); fold a member per role into it with starci app secret migrate --env <env> <member> --to vps --into-existing --execute');
  }
  return { host: block.host ?? 'vps', releasesBase: block.releasesBase ?? null, sealed, serverRecipient: block.serverRecipient ?? null };
}

function imageBuildArgs(c: Collector, at: string, block: Block, members: Set<string>): ImageBuildArgs {
  const out: ImageBuildArgs = { values: {}, sealed: null };
  if (block === undefined) return out;
  if (!closedFields(c, at, block, FIELDS.buildArgs)) return out;
  for (const [key, value] of Object.entries(block.values ?? {})) {
    if (!KEY.test(key) || typeof value !== 'string') c.problem(`${at}.values.${key}`, 'must be KEY: "string"');
    else out.values[key] = value;
  }
  if (block.sealed !== undefined && closedFields(c, `${at}.sealed`, block.sealed, FIELDS.settings)) {
    memberRef(c, `${at}.sealed.member`, block.sealed.member, members);
    out.sealed = { member: block.sealed.member, keys: stringList(c, `${at}.sealed.keys`, block.sealed.keys, KEY, { nonEmpty: true }) };
  }
  return out;
}

function memberRef(c: Collector, at: string, member: unknown, members: Set<string>): void {
  if (!nameField(c, at, member)) return;
  if (members.size > 0 && !members.has(member as string)) c.problem(at, `sealed member ${member} has no .starcistacks/<env>/secrets/${member}.enc`);
}

function images(c: Collector, block: Block, services: Set<string>, members: Set<string>): Record<string, ImageEntry> {
  const out: Record<string, ImageEntry> = {};
  if (block === undefined) return out;
  if (!plain(block)) { c.problem('deploy.images', 'must be a mapping of service to image'); return out; }
  for (const [service, entry] of Object.entries(block) as Array<[string, Block]>) {
    const at = `deploy.images.${service}`;
    nameField(c, at, service);
    if (services.size > 0 && !services.has(service)) c.problem(at, `${service} is not a service of the stack source`);
    if (!closedFields(c, at, entry, FIELDS.image)) continue;
    nameField(c, `${at}.app`, entry.app);
    out[service] = { app: entry.app, buildArgs: imageBuildArgs(c, `${at}.buildArgs`, entry.buildArgs, members) };
  }
  return out;
}

function sourceEntry(c: Collector, at: string, entry: Block, members: Set<string>): SourceEntry | null {
  if (!closedFields(c, at, entry, FIELDS.source)) return null;
  memberRef(c, `${at}.member`, entry.member, members);
  const keys = entry.keys === undefined ? null : stringList(c, `${at}.keys`, entry.keys, KEY, { nonEmpty: true });
  for (const flag of ['required', 'fill']) if (entry[flag] !== undefined && typeof entry[flag] !== 'boolean') c.problem(`${at}.${flag}`, 'must be true or false');
  if (entry.required === true && keys === null) c.problem(`${at}.required`, 'needs an explicit keys list');
  return { member: entry.member, keys, required: entry.required === true, fill: entry.fill === true };
}

function grants(c: Collector, block: Block, services: Set<string>, members: Set<string>): GrantEntry[] {
  const out: GrantEntry[] = [];
  list(block).forEach((grant: Block, index: number) => {
    const at = `deploy.secrets.grants[${index}]`;
    if (!closedFields(c, at, grant, FIELDS.grant)) return;
    nameField(c, `${at}.service`, grant.service);
    if (services.size > 0 && !services.has(grant.service)) c.problem(`${at}.service`, `${grant.service} is not a service of the stack source`);
    if (grant.filePointers !== undefined && typeof grant.filePointers !== 'boolean') c.problem(`${at}.filePointers`, 'must be true or false');
    if (!Array.isArray(grant.from) || grant.from.length === 0) { c.problem(`${at}.from`, 'must list at least one sealed source'); return; }
    const from = grant.from.map((entry: Block, at2: number) => sourceEntry(c, `${at}.from[${at2}]`, entry, members)).filter((item: SourceEntry | null): item is SourceEntry => Boolean(item));
    out.push({ service: grant.service, filePointers: grant.filePointers === true, from });
  });
  return out;
}

/**
 * `deploy.secrets.settings`: one `{ member, keys }` or a list of them, one per member whose plain one-line values the stack
 * interpolates; a key named by two entries is refused, so every setting has one source.
 */
function secretSettings(c: Collector, block: Block, members: Set<string>): SettingsEntry[] {
  if (block === undefined) return [];
  const entries = Array.isArray(block) ? block : [block];
  const seen = new Set<string>();
  return entries.flatMap((entry: Block, index: number): SettingsEntry[] => {
    const at = Array.isArray(block) ? `deploy.secrets.settings[${index}]` : 'deploy.secrets.settings';
    if (!closedFields(c, at, entry, FIELDS.settings)) return [];
    memberRef(c, `${at}.member`, entry.member, members);
    const keys = stringList(c, `${at}.keys`, entry.keys, KEY, { nonEmpty: true });
    for (const key of keys) {
      if (seen.has(key)) c.problem(`${at}.keys`, `${key} is named by another settings entry`);
      seen.add(key);
    }
    return [{ member: entry.member, keys }];
  });
}

function secrets(c: Collector, block: Block, services: Set<string>, members: Set<string>): SecretsConfig {
  if (block === undefined) return { grants: [], settings: [] };
  if (!closedFields(c, 'deploy.secrets', block, FIELDS.secrets)) return { grants: [], settings: [] };
  if (block.grants !== undefined && !Array.isArray(block.grants)) c.problem('deploy.secrets.grants', 'must be a list');
  return { grants: grants(c, block.grants, services, members), settings: secretSettings(c, block.settings, members) };
}

function serviceEnvironment(c: Collector, at: string, entry: Block, probe: DeployProbe): ServiceEnvironment {
  const out: ServiceEnvironment = { files: [], values: {}, settings: {} };
  if (!closedFields(c, at, entry, FIELDS.environment)) return out;
  list<string>(entry.files).forEach((file: string, index: number) => { treeFile(c, `${at}.files[${index}]`, file, probe); out.files.push(file); });
  for (const [key, value] of Object.entries(entry.values ?? {})) {
    if (!UPPER_ENV.test(key) || typeof value !== 'string') c.problem(`${at}.values.${key}`, 'must be KEY: "string"');
    else out.values[key] = value;
  }
  for (const [key, setting] of Object.entries(entry.settings ?? {}) as Array<[string, Block]>) {
    if (!UPPER_ENV.test(key)) { c.problem(`${at}.settings.${key}`, `the environment name must match ${UPPER_ENV}`); continue; }
    if (!closedFields(c, `${at}.settings.${key}`, setting, FIELDS.setting) || !nameField(c, `${at}.settings.${key}.key`, setting.key, KEY)) continue;
    out.settings[key] = { key: setting.key, default: setting.default === undefined ? null : String(setting.default) };
  }
  return out;
}

function environmentBlock(c: Collector, block: Block, services: Set<string>, probe: DeployProbe): Record<string, ServiceEnvironment> {
  const out: Record<string, ServiceEnvironment> = {};
  if (block === undefined) return out;
  if (!plain(block)) { c.problem('deploy.environment', 'must be a mapping of service to environment'); return out; }
  for (const [service, entry] of Object.entries(block)) {
    if (services.size > 0 && !services.has(service)) c.problem(`deploy.environment.${service}`, `${service} is not a service of the stack source`);
    out[service] = serviceEnvironment(c, `deploy.environment.${service}`, entry, probe);
  }
  return out;
}

function configs(c: Collector, block: Block, probe: DeployProbe): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  list(block).forEach((entry: Block, index: number) => {
    const at = `deploy.configs[${index}]`;
    if (!closedFields(c, at, entry, FIELDS.config)) return;
    nameField(c, `${at}.name`, entry.name);
    nameField(c, `${at}.env`, entry.env, KEY);
    treeFile(c, `${at}.file`, entry.file, probe);
    out.push({ name: entry.name, file: entry.file, env: entry.env });
  });
  const seen = new Set<string>();
  for (const entry of out) {
    if (seen.has(entry.name)) c.problem('deploy.configs', `config name ${entry.name} is declared twice`);
    seen.add(entry.name);
  }
  return out;
}

function httpChecks(c: Collector, block: Block): HttpCheck[] {
  return list(block).flatMap((entry: Block, index: number): HttpCheck[] => {
    const at = `deploy.verify.http[${index}]`;
    if (!closedFields(c, at, entry, FIELDS.http)) return [];
    if (!text(entry.name)) c.problem(`${at}.name`, 'must be a non-empty string');
    if (!HTTP_URL.test(String(entry.url))) c.problem(`${at}.url`, 'must be an http(s) URL');
    if (entry.method !== undefined && !['GET', 'POST'].includes(entry.method)) c.problem(`${at}.method`, 'must be GET or POST');
    if (entry.status !== undefined && !(Number.isInteger(entry.status) && entry.status >= 100 && entry.status <= 599)) c.problem(`${at}.status`, 'must be an HTTP status code');
    if (entry.json !== undefined && !plain(entry.json)) c.problem(`${at}.json`, 'must be a mapping of expected fields');
    return [{ name: entry.name, url: entry.url, method: entry.method ?? 'GET', body: entry.body ?? null, status: entry.status ?? 200, json: entry.json ?? null, contains: entry.contains ?? null, retry: entry.retry === true }];
  });
}

function command(c: Collector, at: string, value: unknown): string[] {
  const items = stringList(c, at, value, ARGUMENT, { nonEmpty: true });
  return items;
}

function execChecks(c: Collector, block: Block, services: Set<string>): ExecCheck[] {
  return list(block).flatMap((entry: Block, index: number): ExecCheck[] => {
    const at = `deploy.verify.exec[${index}]`;
    if (!closedFields(c, at, entry, FIELDS.exec)) return [];
    if (!text(entry.name)) c.problem(`${at}.name`, 'must be a non-empty string');
    nameField(c, `${at}.service`, entry.service);
    if (services.size > 0 && !services.has(entry.service)) c.problem(`${at}.service`, `${entry.service} is not a service of the stack source`);
    if (entry.stdout !== undefined) try { new RegExp(entry.stdout, 'u'); } catch { c.problem(`${at}.stdout`, 'must be a valid regular expression'); }
    return [{ name: entry.name, service: entry.service, command: command(c, `${at}.command`, entry.command), stdout: entry.stdout ?? null }];
  });
}

function verify(c: Collector, block: Block, services: Set<string>): VerifyConfig {
  if (block === undefined) return { http: [], exec: [] };
  if (!closedFields(c, 'deploy.verify', block, FIELDS.verify)) return { http: [], exec: [] };
  return { http: httpChecks(c, block.http), exec: execChecks(c, block.exec, services) };
}

function jobs(c: Collector, block: Block, services: Set<string>): JobsConfig | null {
  if (block === undefined) return null;
  if (!closedFields(c, 'deploy.jobs', block, FIELDS.jobs)) return null;
  nameField(c, 'deploy.jobs.service', block.service);
  if (services.size > 0 && !services.has(block.service)) c.problem('deploy.jobs.service', `${block.service} is not a service of the stack source`);
  return { service: block.service, command: command(c, 'deploy.jobs.command', block.command) };
}

const TASK_NAME = /^[a-z][a-z0-9-]{0,40}$/u;
/** The seconds a post-deploy task may run before the deploy counts it failed and rolls back. */
const DEFAULT_TASK_TIMEOUT_SECONDS = 600;

/** The one-off commands (`starci app stack task <name>`): name -> { service, command }, each run inside a running task of the service. */
function tasksOf(c: Collector, block: Block, services: Set<string>): Record<string, TaskConfig> {
  if (block === undefined) return {};
  if (!plain(block)) { c.problem('deploy.tasks', 'must be a mapping'); return {}; }
  const out: Record<string, TaskConfig> = {};
  for (const [name, entry] of Object.entries(block) as Array<[string, Block]>) {
    const at = `deploy.tasks.${name}`;
    if (!TASK_NAME.test(name)) c.problem(at, `the task name must match ${TASK_NAME}`);
    if (!closedFields(c, at, entry, FIELDS.task)) continue;
    nameField(c, `${at}.service`, entry.service);
    if (services.size > 0 && !services.has(entry.service)) c.problem(`${at}.service`, `${entry.service} is not a service of the stack source`);
    if (entry.timeoutSeconds !== undefined && !(Number.isInteger(entry.timeoutSeconds) && entry.timeoutSeconds >= 1 && entry.timeoutSeconds <= 3600)) c.problem(`${at}.timeoutSeconds`, 'must be a whole number of seconds from 1 to 3600');
    out[name] = { service: entry.service, command: command(c, `${at}.command`, entry.command), timeoutSeconds: entry.timeoutSeconds ?? DEFAULT_TASK_TIMEOUT_SECONDS };
  }
  return out;
}

/** The release tasks that run after convergence and before verification: a unique list of declared task names, in run order. */
function postDeploy(c: Collector, block: Block, declared: Record<string, TaskConfig>): string[] {
  if (block === undefined) return [];
  if (!Array.isArray(block)) { c.problem('deploy.postDeploy', 'must be a list of declared task names'); return []; }
  block.forEach((name: unknown, index: number) => {
    const at = `deploy.postDeploy[${index}]`;
    if (typeof name !== 'string' || !Object.hasOwn(declared, name)) c.problem(at, 'must name a task declared under deploy.tasks');
    else if (block.indexOf(name) !== index) c.problem(at, `${name} is listed twice`);
  });
  return block;
}

const REGISTRY_HOST = /^[a-z0-9][a-z0-9.-]*(?::\d{1,5})?$/u;
const VISIBILITY = ['public', 'private'];

/** The image registry: host (default ghcr.io) and the visibility the app's packages are meant to have (default public, the canon scaffold writes it and the app owns it afterwards). */
function registry(c: Collector, block: Block): RegistryConfig {
  const fallback: RegistryConfig = { host: 'ghcr.io', visibility: 'public' };
  if (block === undefined) return fallback;
  if (!closedFields(c, 'deploy.registry', block, FIELDS.registry)) return fallback;
  if (block.host !== undefined) patternField(c, 'deploy.registry.host', block.host, REGISTRY_HOST);
  if (block.visibility !== undefined && !VISIBILITY.includes(block.visibility)) c.problem('deploy.registry.visibility', `must be one of ${VISIBILITY.join(', ')}`);
  return { host: block.host ?? fallback.host, visibility: block.visibility ?? fallback.visibility };
}

function backup(c: Collector, block: Block): BackupConfig | null {
  if (block === undefined) return null;
  if (!closedFields(c, 'deploy.backup', block, FIELDS.backup)) return null;
  if (!PINNED_HELPER_IMAGE.test(String(block.image))) c.problem('deploy.backup.image', 'must be a digest-pinned image reference (no all-zero digest)');
  if (block.keepDays !== undefined && !(Number.isInteger(block.keepDays) && block.keepDays >= 1 && block.keepDays <= 3650)) c.problem('deploy.backup.keepDays', 'must be a whole number of days from 1 to 3650');
  if (block.dir !== undefined && (!REMOTE_BASE.test(String(block.dir)) || String(block.dir).includes('..'))) c.problem('deploy.backup.dir', 'must be an absolute path without ..');
  const volumes = list(block.volumes).flatMap((entry: Block, index: number): Array<{ name: string; volume: string }> => {
    const at = `deploy.backup.volumes[${index}]`;
    if (!closedFields(c, at, entry, FIELDS.backupVolume)) return [];
    nameField(c, `${at}.name`, entry.name);
    nameField(c, `${at}.volume`, entry.volume, VOLUME);
    return [{ name: entry.name, volume: entry.volume }];
  });
  if (volumes.length === 0) c.problem('deploy.backup.volumes', 'must list at least one volume');
  return { image: block.image, keepDays: block.keepDays ?? 14, dir: block.dir ?? null, volumes };
}

/**
 * `deploy.notify`: off unless declared. The webhook URL is a sealed value (never in the declaration, the log or the journal); the default announces every
 * outcome that changed or tried to change the services (accepted, rolled-back, rollback-failed, failed), and `on` narrows or adds `refused`.
 */
function notify(c: Collector, block: Block, members: Set<string>): NotifyConfig | null {
  if (block === undefined) return null;
  if (!closedFields(c, 'deploy.notify', block, FIELDS.notify)) return null;
  if (!closedFields(c, 'deploy.notify.webhook', block.webhook, FIELDS.webhook)) return null;
  memberRef(c, 'deploy.notify.webhook.member', block.webhook.member, members);
  patternField(c, 'deploy.notify.webhook.key', block.webhook.key, KEY);
  const on = block.on === undefined ? ['accepted', 'rolled-back', 'rollback-failed', 'failed'] : stringList(c, 'deploy.notify.on', block.on, new RegExp(`^(?:${NOTIFY_OUTCOMES.join('|')})$`, 'u'), { nonEmpty: true });
  return { webhook: { member: block.webhook.member, key: block.webhook.key }, on };
}

function ingress(c: Collector, block: Block, probe: DeployProbe): IngressConfig | null {
  if (block === undefined) return null;
  const result = normalizeIngress(block, { probe });
  for (const item of result.problems as StackProblem[]) c.problem(item.at, item.message);
  return result.ingress;
}

/**
 * Validates and normalises one `deploy` block.
 *   probe.exists(rel)  does a file exist below .starcistacks/<env>/ ?
 *   probe.services     the service names of the committed stack source (empty set = unknown, service references are not checked)
 *   probe.members      the sealed member slugs of .starcistacks/<env>/secrets (empty set = unknown)
 * Returns { config, problems } ; config is null when a problem was found.
 */
export function normalizeDeploy(block: Block, { project, probe }: { project: string; probe: DeployProbe }): DeployResult {
  const c = collector();
  if (!closedFields(c, 'deploy', block, FIELDS.deploy)) return { config: null, problems: c.problems };
  const services = probe.services ?? new Set();
  const members = probe.members ?? new Set();
  if (block.stack !== undefined) nameField(c, 'deploy.stack', block.stack);
  const tasks = tasksOf(c, block.tasks, services);
  const config: DeployConfig = {
    stack: block.stack ?? project,
    remote: remote(c, block.remote),
    images: images(c, block.images, services, members),
    volumes: block.volumes === undefined ? [] : stringList(c, 'deploy.volumes', block.volumes, VOLUME),
    secrets: secrets(c, block.secrets, services, members),
    environment: environmentBlock(c, block.environment, services, probe),
    configs: configs(c, block.configs, probe),
    passEnv: block.passEnv === undefined ? [] : stringList(c, 'deploy.passEnv', block.passEnv, KEY),
    auto: flag(c, 'deploy.auto', block.auto, false),
    approval: choice(c, 'deploy.approval', block.approval, APPROVALS, 'none') as DeployConfig['approval'],
    platforms: platforms(c, block.platforms),
    verify: verify(c, block.verify, services),
    jobs: jobs(c, block.jobs, services),
    tasks,
    postDeploy: postDeploy(c, block.postDeploy, tasks),
    backup: backup(c, block.backup),
    notify: notify(c, block.notify, members),
    ingress: ingress(c, block.ingress, probe),
    registry: registry(c, block.registry),
  };
  if (block.stack === undefined && !NAME.test(String(project))) c.problem('deploy.stack', `the stack name ${project} must match ${NAME}`);
  return { config: c.problems.length === 0 ? config : null, problems: c.problems };
}

/**
 * The component-to-app ties a stack declaration states: every `environments.<env>.deploy.images.<service>` entry with a string
 * `app`, as `[{ environment, service, app }]`. Read without validating the rest of the block (R294 judges that), so a defect
 * elsewhere in a deploy block never hides the tie R165 reads.
 */
export function deployImageApps(doc: Block): DeployImageTie[] {
  const ties: DeployImageTie[] = [];
  for (const [environment, spec] of Object.entries(plain(doc?.environments) ? doc.environments : {}) as Array<[string, Block]>) {
    const block = plain(spec) && plain(spec.deploy) && plain(spec.deploy.images) ? spec.deploy.images : {};
    for (const [service, entry] of Object.entries(block) as Array<[string, Block]>) if (plain(entry) && typeof entry.app === 'string') ties.push({ environment, service, app: entry.app });
  }
  return ties;
}
