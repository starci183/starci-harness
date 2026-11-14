// stacks-storage-public.mts - R428: an object store a dev environment runs is reachable by browsers and providers through its public route on the
// dev tunnel (contexts/project/stacks.md PROJECT-STACKS-15), over `environments.<env>.local` of .starcistacks/application-stacks.yaml:
//   STORAGE_PUBLIC_ROUTE_MISSING   a public-facing dev environment (it declares a `tunnel`, or a process whose environment holds a public https origin) runs an
//                                  object store (a service of `kind: object-store`, or the `component` of a `data.stores[]` of kind storage) and no
//                                  `tunnel.routes[]` entry routes its S3 port;
//   STORAGE_PUBLIC_ROUTE_CONSOLE   a route reaches an object store's declared admin `console` port (the S3 API port is the only one published);
//   STORAGE_PUBLIC_LINK_INTERNAL   a process that sets STORAGE_ENDPOINT (the internal address of its writes) sets no STORAGE_PUBLIC_URL (the origin its
//                                  links are built on), or one that is not `https://<the host of a route to the object store>`: a loopback address,
//                                  `localhost`, a container service name or any other host is a link no browser or provider can follow.
// Production is not judged here: its STORAGE_ENDPOINT is already a public host (the swarm stack and its ingress, R275).
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { normalizeLocal } from '../stack-local-config.mjs';
import type { LocalBlock, LocalService } from '../stack-local-config.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { found } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

const STACK_FILE = '.starcistacks/application-stacks.yaml';
/** The internal address of an object store's writes and the origin its links are built on: the two values an app receives (the `publicEndpoint` option of `@starci/object-storage`). */
export const STORAGE_ENDPOINT_KEY = 'STORAGE_ENDPOINT';
export const STORAGE_PUBLIC_KEY = 'STORAGE_PUBLIC_URL';

const list = (value: unknown): Parsed[] => (Array.isArray(value) ? value : []);
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1?\]?|[^.]*\.localhost)$/u;

/** The hostname of an origin or URL string (`${port.x}` placeholders are inert), or null when it is not one. */
function hostOf(value: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]+\]|[^/:?#]+)/iu.exec(value.trim());
  return match === null ? null : (match[1] as string).toLowerCase();
}

/** The object stores of a dev environment: a service of `kind: object-store`, or the component of a storage store of `data.stores`. */
function objectStores(local: LocalBlock, storageComponents: ReadonlySet<string>): LocalService[] {
  return local.services.filter((service) => (service.kind === 'object-store' || storageComponents.has(service.name)) && service.port !== null);
}

/** True when the environment publishes anything: a declared tunnel, or a process whose environment holds a public https origin. */
function publicFacing(local: LocalBlock): boolean {
  if (local.tunnel !== undefined) return true;
  return local.processes.some((run) => Object.values(run.env).some((value) => {
    const host = /^https:\/\//u.test(value) ? hostOf(value) : null;
    return host !== null && !LOOPBACK.test(host);
  }));
}

/** R428 over one parsed stack declaration. Pure. */
export function storagePublicFindings(doc: Parsed): Finding[] {
  if (!plain(doc) || !plain(doc.environments)) return [];
  const data = plain(doc.data) ? doc.data : {};
  const storageComponents = new Set(list(data.stores).flatMap((store: Parsed) => (plain(store) && store.kind === 'storage' && typeof store.component === 'string' ? [store.component] : [])));
  const findings: Finding[] = [];
  for (const [env, environment] of Object.entries(doc.environments as Record<string, Parsed>)) {
    if (!plain(environment) || environment.runtime !== 'docker-compose' || environment.local === undefined) continue;
    const { config: local } = normalizeLocal(environment.local, { project: 'app', env });
    if (local === null) continue;
    const stores = objectStores(local, storageComponents);
    if (stores.length === 0 || !publicFacing(local)) continue;
    const at = (code: string, where: string, message: string, extra: Record<string, unknown> = {}) => findings.push(found(code, STACK_FILE, `environments.${env}.local.${where}: ${message} (PROJECT-STACKS-15)`, { environment: env, ...extra }));
    const routes = local.tunnel?.routes ?? [];
    const storeHosts = new Set<string>();
    for (const store of stores) {
      const route = routes.filter((entry) => entry.port === store.port);
      if (route.length === 0) at('STORAGE_PUBLIC_ROUTE_MISSING', 'tunnel', `the object store ${store.name} has no public route: add a tunnel.routes entry whose port is ${store.port ?? ''} (its S3 API port), so links to its files render in a browser and in a provider instead of pointing at the loopback`, { service: store.name });
      for (const entry of route) storeHosts.add(entry.host);
      if (store.console !== undefined) for (const entry of routes.filter((candidate) => candidate.port === store.console)) at('STORAGE_PUBLIC_ROUTE_CONSOLE', `tunnel.routes.${entry.name}`, `the route ${entry.name} reaches the admin console of ${store.name}: publish the S3 API port only`, { service: store.name });
    }
    for (const run of local.processes) {
      const endpoint = run.env[STORAGE_ENDPOINT_KEY];
      if (endpoint === undefined) continue;
      const where = `processes.${run.name}.env`;
      const publicUrl = run.env[STORAGE_PUBLIC_KEY];
      if (publicUrl === undefined) { at('STORAGE_PUBLIC_LINK_INTERNAL', where, `${STORAGE_ENDPOINT_KEY} is the internal address of the writes; set ${STORAGE_PUBLIC_KEY} to the public origin of the store (https://<its tunnel route host>) so the links the app builds can be followed`, { process: run.name }); continue; }
      const host = /^https:\/\/[^/]+\/?$/u.test(publicUrl) ? hostOf(publicUrl) : null;
      if (host === null || !storeHosts.has(host)) at('STORAGE_PUBLIC_LINK_INTERNAL', where, `${STORAGE_PUBLIC_KEY} must be https://<the host of a tunnel route to the object store> (${storeHosts.size === 0 ? 'none declared' : [...storeHosts].join(', ')}), not a loopback address, localhost, a container name or another host`, { process: run.name });
    }
  }
  return findings;
}

/** Findings of R428 at the app root of an app. */
export function storagePublicRuleFindings({ repoRoot, repo, isRoot }: { repoRoot: string; repo: Repo; isRoot: boolean }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const stack = findStackDeclaration(repoRoot);
  return stack.doc ? storagePublicFindings(stack.doc) : [];
}
