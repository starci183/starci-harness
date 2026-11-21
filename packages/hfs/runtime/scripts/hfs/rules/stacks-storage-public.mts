// stacks-storage-public.mts - R428: an object store a dev environment runs publishes its S3 API port only, never its admin console (contexts/project/stacks.md PROJECT-STACKS-15),
// over `environments.<env>.local` of .starcistacks/application-stacks.yaml:
//   STORAGE_PUBLIC_ROUTE_CONSOLE   a dev environment runs an object store (a service of `kind: object-store`, or the `component` of a `data.stores[]` of kind storage) and a
//                                  `tunnel.routes[]` entry reaches the store's declared admin `console` port (the S3 API port is the only one published).
// Production is not judged here: its ingress is R275's.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { normalizeLocal } from '../stack-local-config.mjs';
import type { LocalBlock, LocalService } from '../stack-local-config.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { found } from './read.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

const STACK_FILE = '.starcistacks/application-stacks.yaml';

const list = (value: unknown): Parsed[] => (Array.isArray(value) ? value : []);

/** The object stores of a dev environment: a service of `kind: object-store`, or the component of a storage store of `data.stores`. */
function objectStores(local: LocalBlock, storageComponents: ReadonlySet<string>): LocalService[] {
  return local.services.filter((service) => (service.kind === 'object-store' || storageComponents.has(service.name)) && service.port !== null);
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
    if (stores.length === 0) continue;
    const routes = local.tunnel?.routes ?? [];
    for (const store of stores) {
      if (store.console === undefined) continue;
      for (const entry of routes.filter((candidate) => candidate.port === store.console)) {
        findings.push(found('STORAGE_PUBLIC_ROUTE_CONSOLE', STACK_FILE, `environments.${env}.local.tunnel.routes.${entry.name}: the route ${entry.name} reaches the admin console of ${store.name}: publish the S3 API port only (PROJECT-STACKS-15)`, { environment: env, service: store.name }));
      }
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
