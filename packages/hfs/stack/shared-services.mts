// shared-services.mts - the optional shared-service opt-in of a Swarm environment (`environments.<env>.services` of .starcistacks/application-stacks.yaml,
// contexts/project/shared-services.md): which of the server's shared services (`starci vps service up <id> --service <name>`, ops/vps/services/<name>/)
// this stack calls. Absent, nothing here runs and the render is byte for byte what it was. Present, the render (render.mts) joins each consumer to the
// service's external network, sets its endpoint URL, and grants the sealed key the service's gate checks. Generic: a service is a name, a network, a URL
// and a key; the harness catalog (ops/vps/services/<name>/components.yaml `app`) holds the same defaults the table below does.
import { DEPLOY_CONFIG_CODE } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { refusal } from './errors.mjs';
import type { SecretGrant } from './config.mjs';

/**
 * The shared services an environment can opt in to, with the defaults the harness catalog declares (`app` of ops/vps/services/<name>/components.yaml):
 * the external attachable overlay network the gate answers on, the URL a consumer calls there, the variable the URL is set in, and the sealed key the
 * consumer sends as its bearer token.
 */
export const SHARED_SERVICES = {
  embeddings: { network: 'starci-embeddings', url: 'http://embeddings-gate:8080/v1', urlEnv: 'EMBEDDINGS_BASE_URL', key: 'EMBEDDINGS_API_KEY' },
} as const;
export type SharedServiceName = keyof typeof SHARED_SERVICES;

/** One normalised opt-in: the service, the stack services that call it, where they reach it and the sealed key they are granted. */
export interface SharedServiceOptIn {
  name: SharedServiceName;
  network: string;
  url: string;
  urlEnv: string;
  consumers: string[];
  member: string;
  key: string;
  /** true: the render refuses while the member is not sealed; false (default): it renders without the key and reports it (STACKS_SEALED_MEMBER_PENDING). */
  required: boolean;
}

const NETWORK = /^[a-z][a-z0-9_-]*$/u;
const MEMBER = /^[a-z][a-z0-9-]*$/u;
const KEY = /^[A-Z][A-Z0-9_]*$/u;
const URL_FORM = /^https?:\/\/[^\s"'`]+$/u;
const FIELDS = new Set(['consumers', 'member', 'key', 'required', 'network', 'url', 'urlEnv']);

// reason: the declaration is parsed YAML, judged here
type Parsed = any;

/**
 * The shared-service opt-ins of an environment, refused (STACKS_DEPLOY_CONFIG_INVALID) naming every problem; [] when it declares none. `consumers`
 * defaults to the services the environment builds an image for (`deploy.images`), the app's own code; a required key whose member is not sealed is refused.
 */
export function sharedServicesOf(environment: Parsed, context: { services: Set<string>; members: Set<string>; images: string[]; env: string }): SharedServiceOptIn[] {
  const block = environment?.services;
  if (block === undefined || block === null) return [];
  const { services, members, images, env } = context;
  if (typeof block !== 'object' || Array.isArray(block)) throw refusal(DEPLOY_CONFIG_CODE, `environments.${env}.services is not a mapping of shared service to its opt-in`);
  const problems: string[] = [];
  const out: SharedServiceOptIn[] = [];
  for (const [name, entry] of Object.entries<Parsed>(block)) {
    const defaults = (SHARED_SERVICES as Record<string, (typeof SHARED_SERVICES)[SharedServiceName] | undefined>)[name];
    if (defaults === undefined) { problems.push(`${name} is no shared service; the services are ${Object.keys(SHARED_SERVICES).join(', ')}`); continue; }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { problems.push(`${name} is not a mapping of member, key and consumers`); continue; }
    for (const field of Object.keys(entry)) if (!FIELDS.has(field)) problems.push(`${name}.${field} is not a field of a shared-service opt-in`);
    const consumers: string[] = entry.consumers === undefined ? images : Array.isArray(entry.consumers) ? entry.consumers.map(String) : [];
    if (entry.consumers !== undefined && !Array.isArray(entry.consumers)) problems.push(`${name}.consumers is a list of stack services`);
    if (consumers.length === 0) problems.push(`${name} has no consumer: name the stack services that call it in consumers (the default, the services of deploy.images, is empty)`);
    for (const service of consumers) if (!services.has(service)) problems.push(`${name}.consumers names the service ${service}, which the stack file does not hold`);
    const member = String(entry.member ?? '');
    const key = String(entry.key ?? defaults.key);
    if (!MEMBER.test(member)) problems.push(`${name}.member is the sealed member that holds the key (for example ai)`);
    if (!KEY.test(key)) problems.push(`${name}.key ${key} is no KEY name`);
    if (entry.required !== undefined && typeof entry.required !== 'boolean') problems.push(`${name}.required is true or false`);
    const required = entry.required === true;
    if (required && MEMBER.test(member) && !members.has(member)) problems.push(`${name}: the sealed member ${member} has no .starcistacks/${env}/secrets/${member}.enc.yaml and required is true; seal it (starci vps service grant) or drop required to land the opt-in first`);
    const network = String(entry.network ?? defaults.network);
    const url = String(entry.url ?? defaults.url);
    const urlEnv = String(entry.urlEnv ?? defaults.urlEnv);
    if (!NETWORK.test(network)) problems.push(`${name}.network is not a network name`);
    if (!URL_FORM.test(url)) problems.push(`${name}.url is no http(s) URL`);
    if (!KEY.test(urlEnv)) problems.push(`${name}.urlEnv ${urlEnv} is no variable name`);
    out.push({ name: name as SharedServiceName, network, url, urlEnv, consumers: [...new Set(consumers)], member, key, required });
  }
  if (problems.length > 0) throw refusal(DEPLOY_CONFIG_CODE, `environments.${env}.services: ${problems.slice(0, 6).join('; ')}`);
  return out;
}

/**
 * The secret grants of the opt-ins: each consumer gets the key from its sealed member, through `<KEY>_FILE` (BE-CONFIG-4). A source not marked required
 * carries `optional`, so the render leaves it out while its member is not sealed yet (config.mts `pendingOf`).
 */
export const sharedServiceGrants = (optIns: readonly SharedServiceOptIn[]): SecretGrant[] =>
  optIns.flatMap((optIn) => optIn.consumers.map((service): SecretGrant => ({
    service,
    filePointers: true,
    from: [{ member: optIn.member, keys: [optIn.key], required: optIn.required, fill: false, ...(optIn.required ? {} : { optional: true }) }],
  })));

/** The plain environment one consumer gets: the URL of every service it calls. */
export function sharedServiceEnvironment(optIns: readonly SharedServiceOptIn[], service: string): Record<string, string> {
  return Object.fromEntries(optIns.filter((optIn) => optIn.consumers.includes(service)).map((optIn) => [optIn.urlEnv, optIn.url]));
}

/** The external networks one consumer joins. */
export function sharedServiceNetworks(optIns: readonly SharedServiceOptIn[], service: string): string[] {
  return optIns.filter((optIn) => optIn.consumers.includes(service)).map((optIn) => optIn.network);
}
