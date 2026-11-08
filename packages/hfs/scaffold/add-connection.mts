// `starci app add connection <name> --owner <app> [--isolation database|schema] [--env-prefix <PREFIX>]` - one more database connection of a full app.
//
// A connection is a bounded context's own database (R84, R174): the owner app composes it and no other app reaches it. Declaring one means
// everything `primary` has: the entry of hfs.json `sides.be.connections`, the three files of platform/database that name it (`<name>.connection.ts`,
// `<name>.config.ts`, `<name>.decorators.ts`), their exports and the token its EntityManager is provided under, the `<PREFIX>_URL` key of every
// environment roster (KEYS.md), the dev database (the role, the database and the URL file of the owner process, or the compose secret of a compose
// service), and the production secret `<prefix>-url` (declared, granted to the owner service, mounted, sealed as a placeholder). The verb plans every
// file and every anchor first and writes nothing when one refuses; a connection already declared is refused and nothing changes.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { configuredRecipients } from '../runtime/scripts/hfs/secret-init.mjs';
import { materializeDeclaredPlaceholders } from '../runtime/scripts/hfs/sealed-members.mjs';
import { TEMPLATES_DIR } from '../sync/index.mjs';
import { appendToService } from './add-queue-lite.mjs';
import { EditionRefusal } from './edition-gate.mjs';
import { appendToArray } from './json-append.mjs';
import { ScaffoldError, pascalOf } from './service.mjs';
import { YamlBlockEdit } from './yaml-block-edit.mjs';

// reason: a node of a parsed YAML document (the application stacks, a compose or Swarm model); the shape is the repository's, edited in place by YamlBlockEdit.
type YamlNode = any;

/** The options of the verb. */
export interface ConnectionOptions {
  readonly owner?: string | undefined;
  readonly isolation?: string | undefined;
  readonly envPrefix?: string | undefined;
}

/** What the verb answers: the files it created, the files it changed and what the owner still does. */
export interface ConnectionResult {
  readonly created: string[];
  readonly updated: string[];
  readonly notes: string[];
}

/** A file the verb creates, relative to the app root. */
interface GeneratedFile { readonly relative: string; readonly text: string }
/** A change to an existing file, by absolute path. */
interface FilePatch { readonly file: string; readonly text: string }

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ENV_PREFIX = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const ISOLATIONS = Object.freeze(['database', 'schema']);
const OWNER_KINDS = Object.freeze(['api', 'worker']);
const DATABASE_DIR = 'be/src/modules/platform/database';
const RECIPIENT_POLICY = "This app's own age recipient configured in .sops.yaml";
const KEY_CUSTODY = "SOPS_AGE_KEY in the host's untracked .claude/secret.env";

const read = (file: string): string => fs.readFileSync(file, 'utf8');
const lf = (text: string): string => text.replace(/\r\n/g, '\n');
const upperOf = (name: string): string => name.replaceAll('-', '_').toUpperCase();
const quoted = (value: unknown): string => JSON.stringify(value);
/** A YAML scalar the way the canon writes policy text: plain when it needs no quotes, else JSON-quoted. */
const scalar = (value: string): string => (/^[A-Za-z][^:#]*$/.test(value) && !value.endsWith(' ') ? value : quoted(value));

/** The names a connection derives: its constant, class suffix, URL key, the production secret and the dev password key. */
interface Forms {
  readonly name: string;
  readonly NAME: string;
  readonly Pascal: string;
  readonly prefix: string;
  readonly urlKey: string;
  readonly schemaKey: string;
  readonly secret: string;
  readonly passwordKey: string;
  readonly passwordSecret: string;
  readonly isolation: string;
  readonly owner: string;
}

function formsOf(name: string, options: ConnectionOptions, owner: string, isolation: string): Forms {
  const prefix = options.envPrefix ?? `${upperOf(name)}_DB`;
  return {
    name, NAME: upperOf(name), Pascal: pascalOf(name), prefix, urlKey: `${prefix}_URL`, schemaKey: `${prefix}_SCHEMA`,
    secret: `${prefix.toLowerCase().replaceAll('_', '-')}-url`, passwordKey: `${prefix}_PASSWORD`, passwordSecret: `${prefix.toLowerCase().replaceAll('_', '-')}-password`, isolation, owner,
  };
}

function template(relative: string, forms: Forms): string {
  const values: Record<string, string> = { name: forms.name, NAME: forms.NAME, Pascal: forms.Pascal, PREFIX: forms.prefix };
  return lf(read(path.join(TEMPLATES_DIR, 'be', 'connection', relative))).replace(/@@([A-Za-z]+)@@/g, (whole: string, key: string) => {
    const value = values[key];
    if (value === undefined) throw new ScaffoldError('HFS_ADD_PLACEHOLDER_UNKNOWN', `template be/connection/${relative} uses ${whole}, which add connection does not provide`);
    return value;
  });
}

/** The inputs refused before anything is read: the name, the owner, the isolation and the env prefix. */
function validate(name: string, options: ConnectionOptions): { owner: string; isolation: string } {
  if (!NAME.test(String(name))) throw new ScaffoldError('HFS_ADD_NAME_INVALID', `connection name ${name} must be kebab-case (letters, digits and single dashes)`);
  if (options.owner === undefined) throw new ScaffoldError('HFS_ADD_CONNECTION_OWNER', `add connection ${name} needs --owner <app>: the api or worker app that owns the context (R174)`);
  const isolation = options.isolation ?? 'database';
  if (!ISOLATIONS.includes(isolation)) throw new ScaffoldError('HFS_ADD_CONNECTION_ISOLATION', `--isolation must be ${ISOLATIONS.join(' or ')}, not ${isolation}`);
  if (options.envPrefix !== undefined && !ENV_PREFIX.test(options.envPrefix)) throw new ScaffoldError('HFS_ADD_CONNECTION_PREFIX', `--env-prefix ${options.envPrefix} must be UPPER_SNAKE (letters, digits and single underscores, starting with a letter)`);
  return { owner: options.owner, isolation };
}

/** Appends `lines` after the last line of `text` that `anchor` matches, or at the end when none does. */
function insertAfterLast(lines: string[], anchor: RegExp, added: string): void {
  const at = lines.reduce((last, line, index) => (anchor.test(line) ? index : last), -1);
  lines.splice(at < 0 ? lines.length : at + 1, 0, added);
}

/** The platform/database index with the exports of the connection; unchanged when it already has them. */
function indexPatch(root: string, forms: Forms): FilePatch | null {
  const file = path.join(root, ...DATABASE_DIR.split('/'), 'index.ts');
  const text = lf(read(file));
  const exports = [
    `export { parse${forms.Pascal}DatabaseConfig } from "./${forms.name}.config"`,
    `export { Inject${forms.Pascal}EntityManager, ${forms.NAME}_ENTITY_MANAGER } from "./${forms.name}.decorators"`,
  ].filter((line) => !text.includes(line));
  return exports.length === 0 ? null : { file, text: `${text.trimEnd()}\n${exports.join('\n')}\n` };
}

/** The union of the entity manager tokens, printed on one line or one member per line (Prettier, 120 columns). */
function tokenType(tokens: readonly string[]): string {
  const one = `type EntityManagerToken = ${tokens.map((token) => `typeof ${token}`).join(' | ')}`;
  return one.length <= 120 ? one : `type EntityManagerToken =\n${tokens.map((token) => `    | typeof ${token}`).join('\n')}`;
}

/** platform/database's module provides the EntityManager of each declared connection under its token: this connection's joins the table. */
function modulePatch(root: string, forms: Forms): FilePatch {
  const relative = `${DATABASE_DIR}/database.module.ts`;
  const file = path.join(root, ...relative.split('/'));
  const text = lf(read(file));
  if (text.includes(`${forms.NAME}_ENTITY_MANAGER`)) return { file, text };
  const lines = text.split('\n');
  const declared = lines.findIndex((line) => line.startsWith('type EntityManagerToken ='));
  const table = lines.findIndex((line) => line.startsWith('const ENTITY_MANAGER_TOKENS'));
  const close = table < 0 ? -1 : lines.findIndex((line, index) => index > table && line === '])');
  if (declared < 0 || close < 0 || !lines.some((line) => /from "\.\/[a-z0-9-]+\.connection"$/.test(line)) || !lines.some((line) => /from "\.\/[a-z0-9-]+\.decorators"$/.test(line)))
    throw new ScaffoldError('HFS_ADD_WIRE_INVALID', `add connection registers ${forms.name} in ${relative}, whose connection imports, EntityManagerToken type or ENTITY_MANAGER_TOKENS table are not in the canon shape`);
  let end = declared;
  while (lines[end + 1]?.startsWith('    |')) end += 1;
  const tokens = [...lines.slice(declared, end + 1).join('\n').matchAll(/typeof ([A-Z0-9_]+_ENTITY_MANAGER)/g)].map((match) => match[1]!);
  if (tokens.length === 0) throw new ScaffoldError('HFS_ADD_WIRE_INVALID', `add connection could not read the EntityManagerToken type of ${relative}`);
  lines.splice(close, 0, `    [${forms.NAME}_CONNECTION, ${forms.NAME}_ENTITY_MANAGER],`);
  lines.splice(declared, end - declared + 1, ...tokenType([...tokens, `${forms.NAME}_ENTITY_MANAGER`]).split('\n'));
  insertAfterLast(lines, /from "\.\/[a-z0-9-]+\.connection"$/, `import { ${forms.NAME}_CONNECTION } from "./${forms.name}.connection"`);
  insertAfterLast(lines, /from "\.\/[a-z0-9-]+\.decorators"$/, `import { ${forms.NAME}_ENTITY_MANAGER } from "./${forms.name}.decorators"`);
  return { file, text: lines.join('\n') };
}

/** A schema connection reads `<PREFIX>_SCHEMA`: the connection config gains the optional `schema`, and the two data sources it opens apply it. */
function schemaPatches(root: string): FilePatch[] {
  const patch = (relative: string, anchor: RegExp, line: (indent: string) => string, label: string): FilePatch | null => {
    const file = path.join(root, ...`${DATABASE_DIR}/${relative}`.split('/'));
    const text = lf(read(file));
    if (text.includes('.schema') || text.includes('schema?:')) return null;
    const match = anchor.exec(text);
    if (!match) throw new ScaffoldError('HFS_ADD_WIRE_INVALID', `add connection --isolation schema hands the schema to ${label} in ${DATABASE_DIR}/${relative}, whose canon line ${anchor.source} is missing`);
    return { file, text: `${text.slice(0, match.index + match[0].length)}\n${line(match[1] ?? '')}${text.slice(match.index + match[0].length)}` };
  };
  const spread = (indent: string): string => `${indent}...(connection.schema === undefined ? {} : { schema: connection.schema }),`;
  return [
    patch('database.options.ts', /^( *)readonly url: Secret$/m, (indent) => `${indent}/** The schema of a shared database this connection owns (hfs.json isolation schema); unset for a database of its own. */\n${indent}readonly schema?: string`, 'the connection config'),
    patch('database.module.ts', /^( *)url: connection\.url\.reveal\(\),$/m, spread, 'the TypeORM module'),
    patch('connection-source.client.ts', /^( *)url: connection\.url\.reveal\(\),$/m, spread, 'the one-off data source'),
  ].filter((entry): entry is FilePatch => entry !== null);
}

/** The roster rows of the connection; a roster that lists the URL key already is left alone. */
function keysPatch(file: string, forms: Forms, consumer: string): FilePatch | null {
  const text = read(file);
  if (text.includes(`\`${forms.urlKey}\``)) return null;
  const rows = [`| \`${forms.urlKey}\` | ${consumer} |`, ...(forms.isolation === 'schema' ? [`| \`${forms.schemaKey}\` | ${forms.owner} app, schema of the \`${forms.name}\` connection in the shared database |`] : [])];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.startsWith('|'));
  if (first < 0) return null;
  let last = first;
  while (lines[last + 1]?.startsWith('|')) last += 1;
  lines.splice(last + 1, 0, ...rows);
  return { file, text: (text.includes('\r\n') ? lines.join('\r\n') : lines.join('\n')) };
}

/** The `- name: ...` block of a sealed member / secret entry, with the policy lines the environment already uses. */
function memberBlock(entries: YamlNode, lines: Record<string, string>): string {
  const [sample] = Array.isArray(entries) ? entries : [];
  const policy = sample?.recipientPolicy ?? RECIPIENT_POLICY;
  const custody = sample?.keyCustody ?? KEY_CUSTODY;
  return `${Object.entries(lines).map(([key, value], index) => `${index === 0 ? '- ' : '  '}${key}: ${value}`).join('\n')}\n  recipientPolicy: ${scalar(policy)}\n  keyCustody: ${scalar(custody)}\n`;
}

/** Appends `block` (a sequence item) to the list at `path`, or opens the key when the list is absent or an empty flow sequence. */
function addListItem(edit: YamlBlockEdit, parentPath: readonly string[], key: string, block: string, item: YamlNode): void {
  const parent = parentPath.reduce<YamlNode>((node, step) => node[step], edit.value);
  const current = parent[key];
  if (Array.isArray(current) && current.length > 0) edit.append([...parentPath, key], block);
  else if (Array.isArray(current)) edit.fill([...parentPath, key], block);
  else edit.append(parentPath, `${key}:\n${block.replace(/\n$/, '').split('\n').map((line) => `  ${line}`).join('\n')}\n`);
  parent[key] = [...(Array.isArray(current) ? current : []), item];
}

/** The dev environment of a native stack (`local.database`): one more role and database, its password in custody, its URL file in the owner process. */
function devNativeEdit(edit: YamlBlockEdit, name: string, environment: YamlNode, forms: Forms, notes: string[]): void {
  const local = edit.value.environments[name].local;
  const base = ['environments', name, 'local'] as const;
  const member = String(environment.local.database.password.member);
  const entry = { connection: forms.name, urlEnv: forms.urlKey, password: { member, key: forms.passwordKey } };
  const text = `- connection: ${forms.name}\n  urlEnv: ${forms.urlKey}\n  password: {member: ${member}, key: ${forms.passwordKey}}\n`;
  addListItem(edit, base, 'databases', text, entry);
  addListItem(edit, base, 'custody', `- {member: ${member}, key: ${forms.passwordKey}, kind: password}\n`, { member, key: forms.passwordKey, kind: 'password' });
  const secret = { name: forms.passwordSecret, member, key: forms.passwordKey, where: `secrets/${member}`, recipientPolicy: environment.secrets?.[0]?.recipientPolicy ?? RECIPIENT_POLICY, keyCustody: environment.secrets?.[0]?.keyCustody ?? KEY_CUSTODY };
  addListItem(edit, ['environments', name], 'secrets', memberBlock(environment.secrets, { name: quoted(secret.name), member: quoted(member), key: quoted(forms.passwordKey), where: quoted(secret.where) }), secret);
  const process = (local.processes ?? []).find((run: YamlNode) => run.name === forms.owner);
  if (!process) { notes.push(`${name}: no process ${forms.owner} in environments.${name}.local.processes; list ${forms.urlKey} in its files so it reads ${forms.urlKey}_FILE`); return; }
  const target = [...base, 'processes', { item: 'name', is: forms.owner }] as const;
  try {
    if (process.files === undefined) edit.append(target, `files: [${forms.urlKey}]\n`);
    else {
      try { edit.extendFlow([...target, 'files'], forms.urlKey); } catch { edit.append([...target, 'files'], `- ${forms.urlKey}\n`); }
    }
    process.files = [...(process.files ?? []), forms.urlKey];
  } catch (error) {
    if (!(error instanceof ScaffoldError)) throw error;
    notes.push(`${name}: list ${forms.urlKey} in the files of process ${forms.owner} by hand (${error.message})`);
  }
}

/** The compose file of a dev environment whose owner service the compose project runs: the URL file as a compose secret. */
function composePatch(file: string, relative: string, forms: Forms, mount: { dir: string }): FilePatch {
  const edit = new YamlBlockEdit(read(file), relative);
  const service = forms.owner;
  appendToService(edit, service, 'environment', `${forms.urlKey}_FILE: /run/secrets/${forms.secret}\n`, (environment: YamlNode) => Object.assign(environment ?? {}, { [`${forms.urlKey}_FILE`]: `/run/secrets/${forms.secret}` }));
  appendToService(edit, service, 'secrets', `- source: ${forms.secret}\n  target: ${forms.secret}\n`, (secrets: YamlNode) => [...(secrets ?? []), { source: forms.secret, target: forms.secret }]);
  const block = `${forms.secret}:\n  file: ${mount.dir}/${forms.secret}\n`;
  if (edit.value.secrets === undefined) { edit.lines.push('secrets:', ...block.replace(/\n$/, '').split('\n').map((line) => `  ${line}`)); edit.value.secrets = {}; }
  else edit.append(['secrets'], block);
  edit.value.secrets[forms.secret] = { file: `${mount.dir}/${forms.secret}` };
  return { file, text: `${edit.text().replace(/\n*$/, '')}\n` };
}

/** The Swarm model: the owner service reads the URL from the mounted secret, which the stack declares external at its versioned name. */
function swarmPatch(file: string, relative: string, forms: Forms, runtimeName: string): FilePatch {
  const edit = new YamlBlockEdit(read(file), relative);
  const service = forms.owner;
  appendToService(edit, service, 'environment', `${forms.urlKey}_FILE: /run/secrets/${forms.secret}\n`, (environment: YamlNode) => Object.assign(environment ?? {}, { [`${forms.urlKey}_FILE`]: `/run/secrets/${forms.secret}` }));
  appendToService(edit, service, 'secrets', `- source: ${forms.secret}\n  target: ${forms.secret}\n`, (secrets: YamlNode) => [...(secrets ?? []), { source: forms.secret, target: forms.secret }]);
  edit.append(['secrets'], `${forms.secret}:\n  external: true\n  name: ${quoted(runtimeName)}\n`);
  edit.value.secrets[forms.secret] = { external: true, name: runtimeName };
  return { file, text: edit.text() };
}

/** The production environment: the sealed member, the grant to the owner service and (when the service is in the model) its mount. */
function swarmEdit(root: string, edit: YamlBlockEdit, name: string, environment: YamlNode, forms: Forms, project: string, notes: string[]): { patches: FilePatch[]; runtimeName: string } {
  const runtimeName = `${project}-${name}-${forms.secret}-v1`;
  const model = edit.value.environments[name];
  const derived = forms.secret.replaceAll('-', '_').toUpperCase();
  const member = { name: forms.secret, runtimeName, version: 1, where: `secrets/${forms.secret}`, ...(derived === forms.urlKey ? {} : { key: forms.urlKey }), recipientPolicy: environment.secrets?.[0]?.recipientPolicy ?? RECIPIENT_POLICY, keyCustody: environment.secrets?.[0]?.keyCustody ?? KEY_CUSTODY };
  const lines: Record<string, string> = { name: forms.secret, runtimeName: quoted(runtimeName), version: '1', where: `secrets/${forms.secret}`, ...(derived === forms.urlKey ? {} : { key: forms.urlKey }) };
  addListItem(edit, ['environments', name], 'secrets', memberBlock(environment.secrets, lines), member);
  const composeRelative = `.starcistacks/${name}/${environment.composeFiles?.[0] ?? 'infra/swarm/stack.yaml'}`;
  const composeFile = path.join(root, ...composeRelative.split('/'));
  const services = fs.existsSync(composeFile) ? (parseYaml(read(composeFile))?.services ?? {}) : {};
  if (services[forms.owner] === undefined) {
    notes.push(`${name}: ${composeRelative} runs no service ${forms.owner}; when it does, grant it the member ${forms.secret} (environments.${name}.deploy.secrets.grants) and mount it as ${forms.urlKey}_FILE`);
    return { patches: [], runtimeName };
  }
  const grants = environment.deploy?.secrets?.grants;
  if (Array.isArray(grants)) {
    const at = grants.findIndex((grant: YamlNode) => grant?.service === forms.owner);
    if (at >= 0) {
      const from = ['environments', name, 'deploy', 'secrets', 'grants', { item: 'service', is: forms.owner }, 'from'] as const;
      try { edit.extendFlow(from, `{member: ${forms.secret}}`); } catch { edit.append(from, `- member: ${forms.secret}\n`); }
      model.deploy.secrets.grants[at].from.push({ member: forms.secret });
    } else {
      edit.append(['environments', name, 'deploy', 'secrets', 'grants'], `- service: ${forms.owner}\n  filePointers: true\n  from:\n    - member: ${forms.secret}\n`);
      model.deploy.secrets.grants.push({ service: forms.owner, filePointers: true, from: [{ member: forms.secret }] });
    }
  } else notes.push(`${name}: environments.${name}.deploy.secrets.grants is not a list; grant ${forms.owner} the member ${forms.secret} by hand`);
  return { patches: [swarmPatch(composeFile, composeRelative, forms, runtimeName)], runtimeName };
}

/** Every stack file the connection adds to or changes, planned before anything is written. */
function stackFiles(root: string, forms: Forms, project: string, notes: string[]): { patches: FilePatch[]; sealed: string[] } {
  const manifestFile = path.join(root, '.starcistacks', 'application-stacks.yaml');
  const roster = (env: string, consumer: string): FilePatch[] => {
    const keys = path.join(root, '.starcistacks', env, 'runtime', 'env', 'KEYS.md');
    const patch = fs.existsSync(keys) ? keysPatch(keys, forms, consumer) : null;
    return patch === null ? [] : [patch];
  };
  if (!fs.existsSync(manifestFile)) {
    notes.push('no .starcistacks/application-stacks.yaml: declare the dev database and the production secret of the connection when the stack exists');
    return { patches: [], sealed: [] };
  }
  const manifest = parseYaml(read(manifestFile));
  const edit = new YamlBlockEdit(read(manifestFile), '.starcistacks/application-stacks.yaml');
  const patches: FilePatch[] = [];
  const sealed: string[] = [];
  for (const [name, environment] of Object.entries<YamlNode>(manifest?.environments ?? {})) {
    if (environment?.runtime === 'docker-compose') {
      const owner = forms.owner;
      patches.push(...roster(name, `${owner} app, database connection \`${forms.name}\`; in dev \`up\` hands the native process \`${forms.urlKey}_FILE\`, a host-local file holding the loopback URL of the connection's own role`));
      if (environment.local?.database) {
        devNativeEdit(edit, name, environment, forms, notes);
        notes.push(`${name}: the owner arms "starci app secret init --env ${name} --execute" to create ${forms.passwordKey} once`);
        continue;
      }
      const composeRelative = `.starcistacks/${name}/${environment.composeFiles?.[0] ?? 'infra/compose/stack.yaml'}`;
      const composeFile = path.join(root, ...composeRelative.split('/'));
      const services = fs.existsSync(composeFile) ? (parseYaml(read(composeFile))?.services ?? {}) : {};
      if (services[owner] !== undefined) {
        patches.push(composePatch(composeFile, composeRelative, forms, { dir: `/run/starci-secrets/${project}/${name}` }));
        notes.push(`${name}: the owner creates the database and role of ${forms.name} in the compose postgres and puts its URL in /run/starci-secrets/${project}/${name}/${forms.secret}`);
      } else notes.push(`${name}: no compose service ${owner} and no local.database block; ${forms.urlKey} is declared in the roster only`);
    } else if (environment?.runtime === 'docker-swarm') {
      patches.push(...roster(name, `${forms.owner} app, database connection \`${forms.name}\`; the app reads \`${forms.urlKey}_FILE\` at \`/run/secrets/${forms.secret}\`; the sealed member \`${forms.secret}\` holds a placeholder until the owner replaces it`));
      const planned = swarmEdit(root, edit, name, environment, forms, project, notes);
      patches.push(...planned.patches);
      sealed.push(name);
    }
  }
  if (edit.text() !== read(manifestFile).replace(/\r\n/g, '\n').replace(/\n/g, edit.newline)) patches.unshift({ file: manifestFile, text: edit.text() });
  return { patches, sealed };
}

/** Seals the placeholder of the production URL to the app's configured recipient; without one, `starci app secret init` seals it. */
function sealMembers(root: string, forms: Forms, environments: readonly string[]): string[] {
  if (!environments.length || !fs.existsSync(path.join(root, '.sops.yaml'))) return [];
  const recipients = (env: string) => configuredRecipients(root, path.join(root, '.starcistacks', env, 'secrets', `${forms.secret}.enc`));
  let single: boolean;
  try { single = environments.every((env) => recipients(env).length === 1); } catch { single = false; }
  if (!single) return [];
  return materializeDeclaredPlaceholders(root, {
    recipientsForFile: (file: string) => configuredRecipients(root, file),
    only: (member: { slug: string; env: string }) => member.slug === forms.secret && environments.includes(member.env),
  }).members;
}

/**
 * Adds one connection to a full app: plans every file, then writes them all (and restores the previous text of every changed file when a write
 * fails). Refused before any write: a lite app, an unknown owner, a duplicate name or env prefix, a clashing file, an anchor the canon platform lacks.
 */
export function addConnection({ root, name, options = {} }: { root: string; name: string; options?: ConnectionOptions }): ConnectionResult {
  const { owner, isolation } = validate(name, options);
  const declarationFile = path.join(root, 'hfs.json');
  if (!fs.existsSync(declarationFile)) throw new ScaffoldError('HFS_ADD_NOT_AN_APP', 'add connection runs at the app root containing hfs.json');
  const repo = readRepoDeclaration(loadSlotManifest(), root);
  if (repo.edition === 'lite') throw new EditionRefusal('add connection', 'add connection: full edition only; a lite app declares its one primary connection at scaffold and stays on it');
  const be = repo.sides?.be;
  if (!be) throw new ScaffoldError('HFS_ADD_NO_BACK_END', 'this app has no back-end side');
  if (!be.apps.some((app: { name: string; kind: string }) => app.name === owner && OWNER_KINDS.includes(app.kind)))
    throw new ScaffoldError('HFS_ADD_CONNECTION_OWNER', `--owner ${owner} must be an ${OWNER_KINDS.join(' or ')} app declared in sides.be.apps (R174)`);
  const forms = formsOf(name, options, owner, isolation);
  const declared: ReadonlyArray<{ name: string; envPrefix: string }> = be.connections ?? [];
  if (declared.some((connection) => connection.name === name)) throw new ScaffoldError('HFS_ADD_EXISTS', `connection ${name} is already declared in hfs.json`);
  const clash = declared.find((connection) => `${connection.envPrefix}_`.startsWith(`${forms.prefix}_`) || `${forms.prefix}_`.startsWith(`${connection.envPrefix}_`));
  if (clash) throw new ScaffoldError('HFS_ADD_CONNECTION_PREFIX', `env prefix ${forms.prefix} shares env keys with connection ${clash.name} (${clash.envPrefix}_); pick another --env-prefix`);
  for (const needed of ['index.ts', 'database.module.ts', 'database.options.ts', 'connection-source.client.ts']) {
    if (!fs.existsSync(path.join(root, ...DATABASE_DIR.split('/'), needed)))
      throw new ScaffoldError('HFS_ADD_CONNECTION_PLATFORM', `add connection needs the scaffolded platform/database capability: ${DATABASE_DIR}/${needed} is missing`);
  }
  const created: GeneratedFile[] = [
    { relative: `${DATABASE_DIR}/${name}.connection.ts`, text: template('connection.ts.tpl', forms) },
    { relative: `${DATABASE_DIR}/${name}.config.ts`, text: template(isolation === 'schema' ? 'config-schema.ts.tpl' : 'config.ts.tpl', forms) },
    { relative: `${DATABASE_DIR}/${name}.decorators.ts`, text: template('decorators.ts.tpl', forms) },
  ];
  const clashes = created.filter((entry) => fs.existsSync(path.join(root, ...entry.relative.split('/')))).map((entry) => entry.relative);
  if (clashes.length) throw new ScaffoldError('HFS_ADD_EXISTS', `connection ${name} already has files: ${clashes.join(', ')}`);
  const notes: string[] = [];
  const stack = stackFiles(root, forms, repo.project, notes);
  const declaration = appendToArray(read(declarationFile), ['sides', 'be', 'connections'], { name, envPrefix: forms.prefix, owner, isolation });
  const index = indexPatch(root, forms);
  const patches: FilePatch[] = [
    { file: declarationFile, text: declaration },
    ...(index ? [index] : []),
    modulePatch(root, forms),
    ...(isolation === 'schema' ? schemaPatches(root) : []),
    ...stack.patches,
  ].filter((patch) => read(patch.file) !== patch.text);
  const before = new Map(patches.map((patch) => [patch.file, read(patch.file)]));
  const written: string[] = [];
  let members: string[] = [];
  try {
    for (const entry of created) {
      const target = path.join(root, ...entry.relative.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.text);
      written.push(target);
    }
    for (const patch of patches) fs.writeFileSync(patch.file, patch.text);
    members = sealMembers(root, forms, stack.sealed);
  } catch (error) {
    for (const [file, text] of before) fs.writeFileSync(file, text);
    for (const file of written.reverse()) if (fs.existsSync(file)) fs.rmSync(file);
    throw error;
  }
  notes.push(`compose ${forms.name} in the owner: read parse${forms.Pascal}DatabaseConfig(env) in be/apps/${owner}/src/${owner}.env.ts and pass { ...options.database, entities, migrations } to DatabaseModule.register in its compose/platform.ts; add it to the cli migrate list and the test world declaration (be/src/tests/world)`);
  const relative = (file: string): string => path.relative(root, file).split(path.sep).join('/');
  return { created: [...created.map((entry) => entry.relative), ...members], updated: patches.map((patch) => relative(patch.file)), notes };
}
