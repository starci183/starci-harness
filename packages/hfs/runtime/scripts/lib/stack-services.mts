import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../../engine/yaml.mjs';
import { words } from './dockerfile.mjs';
import { asList } from './list.mjs';

/**
 * The services of a repository's own stack definition, read from `.starcistacks/application-stacks.yaml` and the compose
 * files of one environment (`environments.<env>.composeFiles`, `include:` followed). The R47 `test-world-files` machine check
 * reads the stack through it: it refuses a fake of a service the stack declares, and a `fakedBy` of a stateful one. Nothing
 * here names a product: the stack declares its services, this reads them.
 *
 * Which services the test world runs for real: every declared service except the app's own services (component role
 * `service`, or a compose service under the `app` profile) and observability sidecars (role `observability`). The
 * toxiproxy service (the failure-injection proxy the world routes every real service through) is declared like any other
 * service and is returned as `proxy`.
 */
export const STACKS_DIRECTORY = '.starcistacks';
const STACKS_FILE = 'application-stacks.yaml';
export const DEFAULT_ENVIRONMENT = 'dev';

/** Test-only value the `*_FILE` secret variables of a compose service become (the file variable is replaced by the plain variable of the same name). Never a real secret: the test stack listens on loopback only. */
const TEST_SECRET_VALUE = 'starci-test-secret';

/** How the test stack tells a service answers. */
export type StackProbe = { exec: string[] } | { http: { path: string; containerPort?: number } } | { tcp: true };
/** What the reader knows about a well-known image. */
interface KnownImage { kind: string; aliases: string[]; probe: StackProbe }
/** A bind mount of a stack service. */
export interface StackMount { host: string; container: string; readOnly: boolean }
/** One service of a stack environment. */
export interface StackService {
  name: string;
  image: string;
  repository: string;
  tag: string | null;
  role: string;
  kind: string;
  aliases: string[];
  probe: StackProbe;
  command: string[];
  environment: Record<string, string>;
  ports: number[];
  mounts: StackMount[];
  persistent: boolean;
  runs: boolean;
}
/** The stack of one environment. */
export interface StackReport { environment: string; directory: string; services: StackService[]; proxy: StackService | null }
// reason: the stack declaration and compose files are YAML parsed from disk; the reader picks out the keys it knows.
type YamlDocument = any;
interface ComposeService { name: string; definition: YamlDocument; directory: string }

const NOT_RUN_ROLES = new Set(['service', 'observability']);
const NOT_RUN_PROFILES = new Set(['app']);

/**
 * What the reader knows about the well-known images of a stack, by the repository name of the image: how the test stack
 * tells the service answers (`probe`), which name its fakes could hide behind (`aliases`), and its kind. An image it does not
 * know is probed by TCP and is only matched by its own name.
 */
const KNOWN_IMAGES: Readonly<Record<string, KnownImage>> = Object.freeze({
  postgres: { kind: 'database', aliases: ['postgres', 'postgresql', 'pg', 'database', 'db'], probe: { exec: ['pg_isready', '-h', '127.0.0.1'] } },
  redis: { kind: 'cache', aliases: ['redis', 'cache', 'valkey'], probe: { exec: ['redis-cli', 'ping'] } },
  valkey: { kind: 'cache', aliases: ['redis', 'cache', 'valkey'], probe: { exec: ['valkey-cli', 'ping'] } },
  keycloak: { kind: 'identity', aliases: ['keycloak', 'idp', 'oidc'], probe: { http: { path: '/realms/master' } } },
  minio: { kind: 'storage', aliases: ['minio', 's3', 'storage'], probe: { http: { path: '/minio/health/live', containerPort: 9000 } } },
  mailpit: { kind: 'mail', aliases: ['mailpit', 'mail', 'smtp', 'mailhog', 'maildev'], probe: { http: { path: '/livez', containerPort: 8025 } } },
  mailhog: { kind: 'mail', aliases: ['mailpit', 'mail', 'smtp', 'mailhog', 'maildev'], probe: { http: { path: '/', containerPort: 8025 } } },
  maildev: { kind: 'mail', aliases: ['mailpit', 'mail', 'smtp', 'mailhog', 'maildev'], probe: { http: { path: '/healthz', containerPort: 1080 } } },
  toxiproxy: { kind: 'proxy', aliases: ['toxiproxy'], probe: { http: { path: '/version', containerPort: 8474 } } },
  mysql: { kind: 'database', aliases: ['mysql', 'database', 'db'], probe: { tcp: true } },
  mariadb: { kind: 'database', aliases: ['mariadb', 'mysql', 'database', 'db'], probe: { tcp: true } },
  mongo: { kind: 'database', aliases: ['mongo', 'mongodb', 'database', 'db'], probe: { tcp: true } },
  clickhouse: { kind: 'database', aliases: ['clickhouse', 'database', 'db'], probe: { tcp: true } },
  kafka: { kind: 'queue', aliases: ['kafka', 'queue', 'broker'], probe: { tcp: true } },
  redpanda: { kind: 'queue', aliases: ['redpanda', 'kafka', 'queue', 'broker'], probe: { tcp: true } },
  elasticsearch: { kind: 'search', aliases: ['elasticsearch', 'elastic', 'search'], probe: { tcp: true } },
  opensearch: { kind: 'search', aliases: ['opensearch', 'search'], probe: { tcp: true } },
});

/**
 * The kinds of well-known image that hold data an app reads back. A stack service of one of these kinds (or one the stack gives
 * a persistent volume) is stateful: it always runs real in the test world and can never be faked, even with a declared
 * exception (BE-CONVENTION 1.16: only stateless compute that needs special hardware or an external model may be faked).
 */
export const STATEFUL_KINDS: ReadonlySet<string> = Object.freeze(new Set(['database', 'cache', 'identity', 'storage', 'mail', 'queue', 'search']));

/** The repository name of an image reference: `quay.io/keycloak/keycloak:26.0` -> `keycloak`. */
export const repositoryOf = (image: string): string => {
  const withoutDigest = image.split('@')[0] as string;
  const lastSegment = withoutDigest.split('/').at(-1) ?? withoutDigest;
  return lastSegment.split(':')[0] as string;
};

/** The repository path of an image reference without its tag: `quay.io/keycloak/keycloak:26.0` -> `quay.io/keycloak/keycloak`. */
const imagePathOf = (image: string): string => {
  const withoutDigest = image.split('@')[0] as string;
  const lastSlash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.indexOf(':', lastSlash + 1);
  return colon === -1 ? withoutDigest : withoutDigest.slice(0, colon);
};

/** True when the image reference carries a tag or digest (an external image, not a placeholder of the repository's own build). */
const isTagged = (image: string): boolean => image.includes('@') || image.slice(image.lastIndexOf('/') + 1).includes(':');

/** A compose `environment` (map or `KEY=VALUE` list) as a plain object; a `*_FILE` variable becomes the plain variable with the test value. */
const environmentOf = (value: unknown): Record<string, string> => {
  const entries: [string, string][] = Array.isArray(value)
    ? value.map((item): [string, string] => { const text = String(item); const at = text.indexOf('='); return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)]; })
    : Object.entries((value ?? {}) as Record<string, unknown>).map(([key, item]): [string, string] => [key, item === null ? '' : String(item)]);
  const out: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (key.endsWith('_FILE')) out[key.slice(0, -'_FILE'.length)] = TEST_SECRET_VALUE;
    else out[key] = item;
  }
  return out;
};

/** The container ports a compose `ports` list publishes: `"5432:5432"`, `"127.0.0.1:8080:80/tcp"`, `5432`, `{target: 80}`. */
const containerPortsOf = (value: unknown): number[] => asList(value).map((entry): number => {
  if (entry !== null && typeof entry === 'object') return Number((entry as { target?: unknown }).target);
  const container = (String(entry).split('/')[0] as string).split(':').at(-1);
  return Number(container);
}).filter(Number.isInteger);

/** The bind mounts of a compose `volumes` list whose source is a path (`./realm.json:/x:ro`); named volumes are ephemeral in the test stack and are skipped. */
const mountsOf = (value: unknown, directory: string): StackMount[] => {
  const mounts: StackMount[] = [];
  for (const entry of asList(value)) {
    if (entry !== null && typeof entry === 'object') {
      const long = entry as { type?: unknown; source?: unknown; target?: unknown; read_only?: unknown };
      if (long.type === 'bind' && typeof long.source === 'string') mounts.push({ host: path.resolve(directory, long.source), container: String(long.target), readOnly: long.read_only === true });
      continue;
    }
    const parts = String(entry).split(':');
    // A Windows drive letter is not a separator: a `<drive>:<path>:/y` mount keeps its drive.
    const source = /^[A-Za-z]$/u.test(parts[0] as string) && parts.length > 2 ? `${parts.shift()}:${parts.shift()}` : parts.shift();
    const target = parts.shift();
    if (!source || !target || !(source.startsWith('.') || path.isAbsolute(source))) continue;
    mounts.push({ host: path.resolve(directory, source), container: target, readOnly: parts.includes('ro') });
  }
  return mounts;
};

/** True when a compose `volumes` list gives the service somewhere to keep data: a named volume, or a bind mount that is not read-only. */
const persistsData = (value: unknown): boolean => asList(value).some((entry): boolean => {
  if (entry !== null && typeof entry === 'object') {
    const long = entry as { type?: unknown; read_only?: unknown };
    return long.type === 'volume' || (long.type === 'bind' && long.read_only !== true);
  }
  const parts = String(entry).split(':');
  const source = /^[A-Za-z]$/u.test(parts[0] as string) && parts.length > 2 ? `${parts.shift()}:${parts.shift()}` : parts.shift();
  parts.shift();
  if (!source) return false;
  const isPath = source.startsWith('.') || path.isAbsolute(source);
  return !isPath || !parts.includes('ro');
});

const readYaml = (file: string): YamlDocument => parseYaml(fs.readFileSync(file, 'utf8')) ?? {};

/** The compose services of `file` and of every file it includes: [{name, definition, directory}]. */
const composeServices = (file: string, seen: Set<string> = new Set()): ComposeService[] => {
  const resolved = path.resolve(file);
  if (seen.has(resolved) || !fs.existsSync(resolved)) return [];
  seen.add(resolved);
  const document = readYaml(resolved);
  const directory = path.dirname(resolved);
  const included = asList<YamlDocument>(document.include).flatMap(entry => {
    const target = typeof entry === 'string' ? entry : entry?.path;
    return typeof target === 'string' ? composeServices(path.resolve(directory, target), seen) : [];
  });
  const own = Object.entries<YamlDocument>(document.services ?? {}).map(([name, definition]): ComposeService => ({ name, definition: definition ?? {}, directory }));
  return [...included, ...own];
};

/**
 * The stack of `environment`, or null when the repository declares none. `{ environment, directory, services, proxy }`:
 * `services` are the services the environment declares (`name`, `image`, `repository`, `tag`, `role`, `kind`, `aliases`,
 * `probe`, `command`, `environment`, `ports`, `mounts`, `persistent`, `runs`), `proxy` the toxiproxy service or null.
 */
export function readStack({ root, environment = DEFAULT_ENVIRONMENT }: { root: string; environment?: string }): StackReport | null {
  const stacksFile = path.join(root, STACKS_DIRECTORY, STACKS_FILE);
  if (!fs.existsSync(stacksFile)) return null;
  const declaration = readYaml(stacksFile);
  const env = declaration.environments?.[environment];
  if (!env) return null;
  const directory = path.join(root, STACKS_DIRECTORY, environment);
  const components = declaration.components ?? {};
  const declared = new Map<string, { definition: YamlDocument; directory: string }>();
  for (const composeFile of asList<string>(env.composeFiles)) {
    for (const { name, definition, directory: composeDirectory } of composeServices(path.join(directory, composeFile))) declared.set(name, { definition, directory: composeDirectory });
  }
  const services: StackService[] = [];
  for (const [name, { definition, directory: composeDirectory }] of declared) {
    const image = typeof definition.image === 'string' ? definition.image : components[name]?.image;
    if (typeof image !== 'string') continue;
    const repository = repositoryOf(image);
    const known = KNOWN_IMAGES[repository];
    const role = components[name]?.role ?? 'stateful';
    const profiles = asList<string>(definition.profiles);
    const command = typeof definition.command === 'string' ? words(definition.command) : asList(definition.command).map(String);
    services.push({
      name,
      image,
      repository,
      tag: isTagged(image) ? image.slice(imagePathOf(image).length + 1) : null,
      role,
      kind: known?.kind ?? 'other',
      aliases: known?.aliases ?? [repository],
      probe: known?.probe ?? { tcp: true },
      command,
      environment: environmentOf(definition.environment),
      ports: containerPortsOf(definition.ports),
      mounts: mountsOf(definition.volumes, composeDirectory),
      persistent: persistsData(definition.volumes),
      runs: !NOT_RUN_ROLES.has(role) && !profiles.some(profile => NOT_RUN_PROFILES.has(profile)),
    });
  }
  const proxy = services.find(service => service.kind === 'proxy') ?? null;
  return { environment, directory, services, proxy };
}

/** The names a fake of `service` could hide behind: its own name, its image repository and the aliases of a well-known image. */
export const namesOfService = (service: Pick<StackService, 'name' | 'repository' | 'aliases'>): string[] => [...new Set([service.name, service.repository, ...service.aliases])];
