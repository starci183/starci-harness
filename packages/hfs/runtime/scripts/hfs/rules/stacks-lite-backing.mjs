// R276: lite keeps Postgres and pgvector on managed Supabase, admits only the backing services available to its edition,
// and runs a declared Redis as one service with AOF fsynced at least every second on a named volume and no eviction
// (ruling:R212/case-10, owner:lite-vector-is-pgvector); sidecar SQLite persists on declared named volumes.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { composeEntries } from '../../lib/compose-values.mjs';
import { repositoryOf } from '../../lib/stack-services.mjs';
import { loadSlotManifest } from '../slots.mjs';
import { judgedInEdition } from '../edition-slots.mjs';
import { readJson } from './read.mjs';
import { stacksDeploymentFindings } from './stacks-runtime.mjs';

const DATABASE_IMAGE = /^(?:postgres(?:ql)?|postgresql-repmgr|mongo(?:db)?|mongodb-community-server)$/i;
const APPEND_ONLY = /(?:^|\s)--appendonly\s+yes(?:\s|$)/;
const EVICTION_POLICY = /(?:^|\s)--maxmemory-policy\s+(\S+)/;
const FSYNC_POLICY = /(?:^|\s)--appendfsync\s+(\S+)/;
const BOUNDED_FSYNC = new Set(['everysec', 'always']);
const REDIS_DATA_DIR = '/data';
const DATABASE_ADAPTER_KEYS = new Set(['db_type', 'database_type', 'db_provider', 'database_provider', 'db_client', 'database_client', 'db_adapter', 'database_adapter']);
const SQLITE_ADAPTERS = new Set(['sqlite', 'sqlite3', 'better-sqlite3', 'sql.js']);
const DATABASE_URL_KEY = /DB|DATABASE|POSTGRES|REDIS|MONGO/i;
const NON_SQLITE_URL = /^(?:postgres(?:ql)?|rediss?|mongo(?:db)?(?:\+srv)?|mysql|mariadb|mssql|sqlserver|cockroachdb):/i;
const SQLITE_URL = /^sqlite(?:3)?:/i;
const NAMED_VOLUME = /^[a-z0-9][a-z0-9_.-]*$/i;
const mapping = value => plain(value) ? value : {};
const present = value => typeof value === 'string' && Boolean(value.trim());

/** The backing service (a key of ruleParams.be.backing) whose image repository `image` names, or null. */
function serviceOfImage(catalog, image) {
  if (!present(image)) return null;
  const repository = repositoryOf(image).toLowerCase();
  return Object.keys(catalog).find(service => catalog[service].images.includes(repository)) ?? null;
}

/** The services hfs.json sides.be.backing declares: from the resolved declaration, else from hfs.json at the app root. */
function declaredBacking(repo, repoRoot) {
  const declared = repo?.sides?.be?.backing ?? repo?.backing ?? (present(repoRoot) ? readJson(repoRoot, 'hfs.json')?.sides?.be?.backing : undefined);
  return new Set(Array.isArray(declared) ? declared : []);
}

function imageIssues(components, services, { catalog, declared }) {
  const errors = [];
  for (const [prefix, inventory] of [['components', components], ['services', services]]) {
    for (const [id, entry] of Object.entries(inventory)) {
      if (!present(entry?.image)) continue;
      const service = serviceOfImage(catalog, entry.image);
      if (DATABASE_IMAGE.test(repositoryOf(entry.image)))
        errors.push({ code: 'STACKS_LITE_SELFHOSTED_DB', at: `${prefix}.${id}.image`,
          message: 'lite must not run a self-hosted Postgres or Mongo database image; use managed Supabase backing' });
      else if (service !== null && !judgedInEdition(catalog[service], 'lite'))
        errors.push({ code: 'STACKS_LITE_SELFHOSTED_DB', at: `${prefix}.${id}.image`,
          message: `lite must not run ${service}; vector search uses Supabase pgvector (owner:lite-vector-is-pgvector)` });
      else if (service !== null && !declared.has(service))
        errors.push({ code: 'STACKS_LITE_SELFHOSTED_DB', at: `${prefix}.${id}.image`,
          message: `lite runs ${service} only when hfs.json sides.be.backing declares it for the capability that needs it (ruling:R212/case-10)` });
    }
  }
  return errors;
}

const commandText = service => (Array.isArray(service?.command) ? service.command.map(String).join(' ') : String(service?.command ?? ''));

function persistentDataMount(entry, volumes) {
  if (typeof entry === 'string') {
    const [name, target, options = ''] = entry.split(':');
    return NAMED_VOLUME.test(name) && Object.hasOwn(volumes, name) && target === REDIS_DATA_DIR && !options.split(',').includes('ro');
  }
  return plain(entry) && entry.type === 'volume' && Object.hasOwn(volumes, entry.source) && entry.target === REDIS_DATA_DIR && entry.read_only !== true;
}

/**
 * AOF on a writable named volume at the data directory, fsynced at least every second (everysec, the Redis default, or always),
 * and no eviction policy but noeviction (the Redis default).
 */
function persisted(service, volumes) {
  const command = commandText(service);
  const policy = EVICTION_POLICY.exec(command)?.[1].replaceAll(/["']/g, '');
  const fsync = FSYNC_POLICY.exec(command)?.[1].replaceAll(/["']/g, '');
  return APPEND_ONLY.test(command) && (policy === undefined || policy === 'noeviction') && (fsync === undefined || BOUNDED_FSYNC.has(fsync))
    && (Array.isArray(service.volumes) ? service.volumes : []).some(entry => persistentDataMount(entry, volumes));
}

/** Queue jobs live in Redis, so a declared Redis runs as exactly one stack service that persists every job and evicts none. */
function redisPersistenceIssues(services, volumes, { catalog, declared }) {
  if (!declared.has('redis')) return [];
  const redis = Object.entries(services).filter(([, service]) => serviceOfImage(catalog, service?.image) === 'redis');
  if (redis.length !== 1) return [{ code: 'STACKS_LITE_REDIS_PERSISTENCE', at: 'services',
    message: `hfs.json sides.be.backing declares redis, so the lite stack runs exactly one Redis service; it runs ${redis.length}` }];
  return redis.filter(([, service]) => !persisted(service, volumes))
    .map(([id]) => ({ code: 'STACKS_LITE_REDIS_PERSISTENCE', at: `services.${id}`,
      message: `the lite Redis runs redis-server --appendonly yes with appendfsync everysec (the default) or always, a writable named volume mounted at ${REDIS_DATA_DIR} and maxmemory-policy noeviction (the default), so queue jobs survive a restart and are never evicted` }));
}

function unsupportedAdapter(service) {
  for (const [key, value] of composeEntries(service?.environment, { stringsOnly: true })) {
    const adapterKey = DATABASE_ADAPTER_KEYS.has(key.toLowerCase());
    if (adapterKey && !SQLITE_ADAPTERS.has(String(value).trim().toLowerCase())) return true;
    if (DATABASE_URL_KEY.test(key) && typeof value === 'string' && NON_SQLITE_URL.test(value.trim())) return true;
  }
  return false;
}

function sqliteAdapter(service) {
  return composeEntries(service?.environment, { stringsOnly: true }).some(([key, value]) => {
    const adapter = String(value).trim().toLowerCase();
    return DATABASE_ADAPTER_KEYS.has(key.toLowerCase()) && SQLITE_ADAPTERS.has(adapter)
      || DATABASE_URL_KEY.test(key) && SQLITE_URL.test(adapter);
  });
}

function renderedAdapterIssues(components, services) {
  const errors = [];
  for (const [id, service] of Object.entries(services)) {
    const component = mapping(components[id]);
    if (component.role !== 'sidecar' && component.database === undefined) continue;
    if (!unsupportedAdapter(service)) continue;
    errors.push({ code: 'STACKS_SIDECAR_DB_UNSUPPORTED', at: `services.${id}.environment`,
      message: 'rendered sidecar database adapter configuration must use SQLite; Postgres, Redis and Mongo dependencies are forbidden in lite' });
  }
  return errors;
}

function writableVolume(entry, source) {
  if (typeof entry === 'string') {
    const [name, target, options = ''] = entry.split(':');
    return name === source && present(target) && target.startsWith('/') && !options.split(',').includes('ro');
  }
  return plain(entry) && entry.type === 'volume' && entry.source === source && present(entry.target) && entry.target.startsWith('/') && entry.read_only !== true;
}

function sqliteVolumeIssue({ id, component, database, services, bindings, volumes }) {
  const declared = Array.isArray(component.volumes) && component.volumes.includes(database.volume);
  const active = Object.hasOwn(bindings, id) || Object.hasOwn(services, id);
  const mounts = Array.isArray(services[id]?.volumes) ? services[id].volumes : [];
  const mounted = Object.hasOwn(volumes, database.volume) && mounts.some(entry => writableVolume(entry, database.volume));
  if (present(database.volume) && NAMED_VOLUME.test(database.volume) && declared && (!active || mounted)) return [];
  return [{ code: 'STACKS_SIDECAR_VOLUME_UNDECLARED', at: `components.${id}.database.volume`,
    message: 'a SQLite sidecar needs a declared persistent component volume, a top-level rendered named volume and a writable mount' }];
}

function sidecarIssues({ components, services, bindings, volumes }) {
  const errors = [];
  for (const [id, entry] of Object.entries(components)) {
    const component = mapping(entry);
    if (component.database === undefined) {
      if (component.role === 'sidecar' && sqliteAdapter(services[id]))
        errors.push(...sqliteVolumeIssue({ id, component, database: {}, services, bindings, volumes }));
      continue;
    }
    const database = mapping(component.database);
    if (database.provider !== 'sqlite') {
      errors.push({ code: 'STACKS_SIDECAR_DB_UNSUPPORTED', at: `components.${id}.database.provider`,
        message: 'a lite sidecar that needs a database must use SQLite on a declared persistent volume' });
      continue;
    }
    errors.push(...sqliteVolumeIssue({ id, component, database, services, bindings, volumes }));
  }
  return errors;
}

/** The lite backing contract; full keeps its existing backing choices. */
export function liteBackingIssues({ doc, environment, spec = doc?.environments?.[environment], model, repo, repoRoot, edition = repo?.edition }) {
  if (edition !== 'lite' || spec?.runtime !== 'docker-swarm') return [];
  const components = mapping(doc?.components), services = mapping(model?.services), volumes = mapping(model?.volumes);
  const backing = { catalog: mapping(loadSlotManifest().ruleParams?.be?.backing), declared: declaredBacking(repo, repoRoot) };
  return [
    ...imageIssues(components, services, backing),
    ...redisPersistenceIssues(services, volumes, backing),
    ...renderedAdapterIssues(components, services),
    ...sidecarIssues({ components, services, bindings: mapping(spec.components), volumes }),
  ];
}

/** HFS finder over tracked rendered models; unavailable evidence is reported by R267. */
export function stacksLiteBackingFindings(context) {
  if (context.repo?.edition !== 'lite') return [];
  return stacksDeploymentFindings(context, liteBackingIssues);
}
