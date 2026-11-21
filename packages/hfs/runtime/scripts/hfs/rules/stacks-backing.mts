// R276: an app runs exactly its own PostgreSQL (the db component, the image its managed .starcistacks/images/db/Dockerfile builds) with pgvector, and admits only the backing services hfs.json declares.
// (A declared Redis running as one AOF service on a named volume, and sidecar SQLite persisting on declared named volumes, stay conventions held by review.)
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { repositoryOf } from '../../lib/stack-services.mjs';
import { loadSlotManifest } from '../slots.mjs';
import { readJson } from './read.mjs';
import { stacksDeploymentFindings } from './stacks-runtime.mjs';
import type { Parsed, Repo } from './rule-types.mjs';

const DATABASE_IMAGE = /^(?:postgres(?:ql)?|postgresql-repmgr|mongo(?:db)?|mongodb-community-server)$/i;
const mapping = (value: Parsed) => plain(value) ? value : {};
const present = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());

/** The backing service (a key of ruleParams.be.backing) whose image repository `image` names, or null. */
function serviceOfImage(catalog: Parsed, image: string) {
  if (!present(image)) return null;
  const repository = repositoryOf(image).toLowerCase();
  return Object.keys(catalog).find(service => catalog[service].images.includes(repository)) ?? null;
}

/** The services hfs.json sides.be.backing declares: from the resolved declaration, else from hfs.json at the app root. */
function declaredBacking(repo: Repo, repoRoot?: string) {
  const declared = repo?.sides?.be?.backing ?? repo?.backing ?? (present(repoRoot) ? readJson(repoRoot, 'hfs.json')?.sides?.be?.backing : undefined);
  return new Set(Array.isArray(declared) ? declared : []);
}

function imageIssues(components: Parsed, services: Parsed, { catalog, declared }: { catalog: Parsed; declared: Parsed }) {
  const errors = [];
  for (const [prefix, inventory] of [['components', components], ['services', services]]) {
    for (const [id, entry] of Object.entries<Parsed>(inventory)) {
      if (!present(entry?.image)) continue;
      const service = serviceOfImage(catalog, entry.image);
      if (DATABASE_IMAGE.test(repositoryOf(entry.image)))
        errors.push({ code: 'STACKS_LITE_SELFHOSTED_DB', at: `${prefix}.${id}.image`,
          message: 'an app runs one database, the db component of the image .starcistacks/images/db/Dockerfile builds (the official postgres image plus pgvector); no other Postgres or Mongo image' });
      else if (service !== null && !declared.has(service))
        errors.push({ code: 'STACKS_LITE_SELFHOSTED_DB', at: `${prefix}.${id}.image`,
          message: `an app runs ${service} only when hfs.json sides.be.backing declares it for the capability that needs it` });
    }
  }
  return errors;
}

/** The backing contract of a docker-swarm environment. */
export function backingIssues({ doc, environment, spec = doc?.environments?.[environment], model, repo, repoRoot }: { doc: Parsed; environment: Parsed; spec?: Parsed; model: Parsed; repo: Repo; repoRoot?: string }) {
  if (spec?.runtime !== 'docker-swarm') return [];
  const components = mapping(doc?.components), services = mapping(model?.services);
  const backing = { catalog: mapping(loadSlotManifest().ruleParams?.be?.backing), declared: declaredBacking(repo, repoRoot) };
  return imageIssues(components, services, backing);
}

/** HFS finder over tracked rendered models; unavailable evidence is reported by R267. */
export function stacksBackingFindings(context: Parsed) {
  return stacksDeploymentFindings(context, backingIssues);
}
