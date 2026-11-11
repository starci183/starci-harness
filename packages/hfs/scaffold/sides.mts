// sides.mts - the root files of a new app for the sides it declares (PROJECT-1, R399): the stack declaration's `sides` field and the plain-words
// line above it, and, for a project without a front end, the starter's fe components, images, local processes, probes, origins, Swarm services,
// locked images and ingress sites taken out of the edition's templates (each YAML edit is comment-preserving and refused unless the text parses
// to the edited document, yaml-block-edit.mts), with a README that cites only the declared sides.
import type { ProjectSide } from '../runtime/scripts/hfs/project-sides.mjs';
export { stackSidesVars } from '../sync/declared-sides.mjs';
import type { ContractKind } from '../runtime/scripts/hfs/contract-kind.mjs';
import { YamlBlockEdit, type YamlDocument, type YamlStep } from './yaml-block-edit.mjs';

/** The app-relative stack declaration the app skeleton writes. */
export const STACK_DECLARATION_FILE = '.starcistacks/application-stacks.yaml';

const SIDE_WORDS: Readonly<Record<ProjectSide, string>> = Object.freeze({ be: 'back end (be)', fe: 'front end (fe)', packages: 'root workspace packages (packages)' });

const mapping = (value: unknown): Record<string, YamlDocument> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, YamlDocument> : {});

/** The healthAssertions of a release, for the sides and contract the project serves. */
const healthAssertions = (sides: readonly ProjectSide[], contract: ContractKind): string => `[${[
  'API /health/live', 'API /health/ready',
  ...(sides.includes('fe') ? ['Web /health/live'] : []),
  `Signed-in ${contract === 'rest' ? 'REST' : 'GraphQL'} request over TLS`,
].join(', ')}]`;

/**
 * The starter stack declaration `text` for a project of `sides` serving `contract`: unchanged for the default (be and fe, graphql); without fe,
 * every component, deploy image, local port, process, probe and origin of the starter's fe apps (`feApps`) is removed and the api's
 * browser origins point at the api itself; a rest api states it in its purpose and release assertion.
 */
export function stackForSides(text: string, { sides, contract, feApps, hosts = [] }: { sides: readonly ProjectSide[]; contract: ContractKind; feApps: readonly string[]; hosts?: readonly string[] }): string {
  if (sides.includes('fe') && contract === 'graphql') return text;
  const edit = new YamlBlockEdit(text, STACK_DECLARATION_FILE);
  const doc = edit.value;
  const has = (path: readonly string[]): boolean => path.reduce((node: YamlDocument, key) => mapping(node)[key], doc) !== undefined;
  const removeKey = (path: readonly string[]): void => { if (has(path)) edit.remove(path); };
  const fe = new Set(feApps);
  const isFe = (name: unknown): boolean => typeof name === 'string' && [...fe].some((app) => name === app || name.startsWith(`${app}-`) || name.startsWith(`${app} `));
  if (!sides.includes('fe')) {
    for (const app of feApps) removeKey(['components', app]);
    for (const [environment, spec] of Object.entries(mapping(doc.environments))) {
      const at = (...keys: string[]): string[] => ['environments', environment, ...keys];
      for (const app of feApps) {
        removeKey(at('components', app));
        removeKey(at('local', 'ports', app));
        removeKey(at('deploy', 'images', app));
      }
      const local = mapping(mapping(spec).local);
      for (const list of ['services', 'processes', 'ready', 'verify', 'origins']) if (Array.isArray(local[list])) edit.removeItems(at('local', list), (item) => isFe(item?.name));
      const api = Array.isArray(local.processes) ? (local.processes as YamlDocument[]).find((item) => item?.name === 'api') : undefined;
      for (const key of ['HTTP_SECURITY_ALLOWED_ORIGINS', 'AUTH_WEB_ORIGIN']) {
        if (typeof mapping(api?.env)[key] === 'string' && String(api.env[key]).includes('${port.')) edit.set([...at('local', 'processes'), { item: 'name', is: 'api' }, 'env', key] as YamlStep[], '"http://localhost:${port.api}"');
      }
      const http = mapping(mapping(spec).deploy).verify;
      if (Array.isArray(mapping(http).http)) edit.removeItems(at('deploy', 'verify', 'http'), (item) => isFe(String(item?.name ?? '').split(' ')[0]));
      if (Array.isArray(mapping(mapping(spec).release).healthAssertions)) edit.set(at('release', 'healthAssertions'), healthAssertions(sides, contract));
      const ingressHosts = mapping(mapping(spec).ingress).hosts;
      if (Array.isArray(ingressHosts) && ingressHosts.some((host) => hosts.includes(String(host)))) edit.set(at('ingress', 'hosts'), `[${ingressHosts.filter((host) => !hosts.includes(String(host))).map((host) => JSON.stringify(host)).join(', ')}]`);
      if (Array.isArray(mapping(spec).dns)) edit.removeItems(at('dns'), (item) => hosts.includes(String(item?.host)));
    }
  } else {
    for (const environment of Object.keys(mapping(doc.environments))) if (Array.isArray(mapping(mapping(mapping(doc.environments)[environment]).release).healthAssertions)) edit.set(['environments', environment, 'release', 'healthAssertions'], healthAssertions(sides, contract));
  }
  if (contract === 'rest' && typeof mapping(mapping(doc.components).api).purpose === 'string') edit.set(['components', 'api', 'purpose'], String(doc.components.api.purpose).replace('GraphQL API', 'REST API'));
  return edit.text();
}

/** The Swarm model and the images lock of a project without fe: the services and locked images of the starter's fe apps removed. */
function withoutFeKeys(text: string, file: string, parent: string, feApps: readonly string[]): string {
  const edit = new YamlBlockEdit(text, file);
  for (const app of feApps) if (mapping(mapping(edit.value)[parent])[app] !== undefined) edit.remove([parent, app]);
  return edit.text();
}

/** A Caddyfile without the site blocks that proxy to a starter fe app; `hosts` collects the sites removed. */
function withoutFeSites(text: string, feApps: readonly string[], hosts: string[]): string {
  const site = new RegExp(String.raw`^(\S[^\n{]*?)\s*\{\n\s+reverse_proxy (?:${feApps.join('|')}):\d+\n\}\n(?:\n)?`, 'gmu');
  return text.replace(site, (_whole: string, host: string) => { hosts.push(host.trim()); return ''; });
}

/** The README of a project that lacks an app side: what it holds, citing only the declared sides' paths and the scripts it has. */
function sidesReadme({ project, edition, sides, contract, api }: { project: string; edition: string; sides: readonly ProjectSide[]; contract: ContractKind; api: string }): string {
  const held = [
    ...(sides.includes('be') ? [`- \`be/\`: the Nest back end, its api app in \`be/apps/${api}\`, serving ${contract === 'rest' ? `REST controllers described by the committed OpenAPI document \`be/contracts/${api}/openapi.json\` (\`npm run contract:emit\` writes it)` : 'GraphQL, whose schema `npm run contract:emit` commits once the app serves an operation'}.`] : []),
    ...(sides.includes('fe') ? ['- `fe/`: the Next front end, its apps under `fe/apps`.'] : []),
    ...(sides.includes('packages') ? [`- \`packages/\`: the root workspace packages, \`packages/${project}-shared\` first, built with \`npm run build:modules\`.`] : []),
    ...(edition === 'lite' ? ['- `db/`: the SQL migrations, the schema authority of the database.'] : []),
  ];
  const missing = (['be', 'fe'] as const).filter((side) => !sides.includes(side)).map((side) => SIDE_WORDS[side]);
  const stack = [
    ...(sides.includes('be') ? [`NestJS in \`be/\` serving ${contract === 'rest' ? 'REST with an OpenAPI 3 document (@nestjs/swagger)' : 'GraphQL'}`] : []),
    ...(sides.includes('fe') ? ['Next.js in `fe/`'] : []),
    ...(sides.includes('packages') ? ['TypeScript workspace packages in `packages/`'] : []),
    ...(edition === 'lite' ? ['PostgreSQL with SQL migrations in `db/`'] : []),
  ];
  return [
    `# ${project}`,
    '',
    `One StarCi ${edition} app of the sides ${sides.join(', ')}.`,
    '',
    '## Overview',
    '',
    `One StarCi ${edition} app with no ${missing.join(' and no ')}: \`hfs.json\` declares its sides (\`sides\`), and \`.starcistacks/application-stacks.yaml\` states the same ones.`,
    '',
    '## Stack',
    '',
    `TypeScript everywhere: ${stack.join(', ')}; npm workspaces and Turbo for the workspace tasks.`,
    '',
    '## Repository layout',
    '',
    ...held,
    '',
    '## Development',
    '',
    '```sh',
    'npm install',
    ...(sides.includes('be') ? ['npm run contract:emit'] : []),
    'npm run typecheck',
    'npm run lint',
    ...(sides.includes('be') ? ['npm test', 'npm run build:be'] : []),
    '```',
    '',
    '## Work',
    '',
    'Work records live in `.starciwork/`; `.starciwork/workspace.yaml` supplies the project id and the repository roles the Work tools read.',
    '',
  ].join('\n');
}

/** A file of the scaffold: app-relative path and text. */
interface SidesFile { readonly path: string; readonly content: string }

/**
 * The root files of a new app for its sides (PROJECT-1): the default (be and fe, graphql) unchanged; without fe the Caddyfile sites, Swarm
 * services, locked images and stack entries of the starter's fe apps (`feApps`) removed and the README written for the declared sides; a rest
 * api named so in the stack declaration.
 */
export function filesForSides<T extends SidesFile>(files: readonly T[], { project, edition, sides, contract, feApps, api = 'api' }: { project: string; edition: string; sides: readonly ProjectSide[]; contract: ContractKind; feApps: readonly string[]; api?: string }): T[] {
  if (sides.includes('fe') && sides.includes('be') && contract === 'graphql') return [...files];
  const hosts: string[] = [];
  const withFe = sides.includes('fe');
  const caddy = files.map((file) => (!withFe && file.path.endsWith('/Caddyfile') ? { ...file, content: withoutFeSites(file.content, feApps, hosts) } : file));
  return caddy.map((file) => {
    if (file.path === STACK_DECLARATION_FILE) return { ...file, content: stackForSides(file.content, { sides, contract, feApps, hosts }) };
    if (withFe) return file;
    if (/^\.starcistacks\/[^/]+\/infra\/swarm\/stack\.yaml$/u.test(file.path)) return { ...file, content: withoutFeKeys(file.content, file.path, 'services', feApps) };
    if (/^\.starcistacks\/[^/]+\/infra\/swarm\/releases\/images\.lock\.yaml$/u.test(file.path)) return { ...file, content: withoutFeKeys(file.content, file.path, 'images', feApps) };
    if (file.path === 'README.md') return { ...file, content: sidesReadme({ project, edition, sides, contract, api }) };
    // The codegen generates the front end's wire types: without fe the operational scripts folder starts empty (slot app.scripts).
    if (file.path === 'scripts/codegen.mjs') return { ...file, path: 'scripts/.gitkeep', content: '' };
    return file;
  });
}
