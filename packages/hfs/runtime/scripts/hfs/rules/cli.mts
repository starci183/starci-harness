// cli.mts - the command lines of a back end: its one ops cli (R147 BE_CLI_REQUIRED) and its client clis (R397 BE_CLI_CLIENT).
//   BE_CLI_REQUIRED       a back end that declares a connection (it has migrations to run) or tracks an ops command (src/features/cli/)
//                         declares exactly one app of kind cli, named cli (be/apps/cli), and tracks its image be/apps/cli/Dockerfile:
//                         one image, run as `cli <group> <command>`. An app of kind cli with another name, or a second one, is refused.
//   BE_CLI_COMMAND_SHAPE  (R149, the part one file cannot see) two command classes of one cli feature root share a class name: nest-commander
//                         matches a sub-command by its class name, so the second `RunCli` runs the first one's action
//                         (contexts/code/be/cli.md BE-CLI-2). The ops root and each client cli's root are judged apart: each is its own app.
//   BE_CLI_CLIENT         an app of kind client-cli is a command line a user installs from npm and runs on their own machine: hfs.json
//                         declares its `package` and `bin` (no other app kind does, and no two client clis share either), its commands
//                         live in its own feature root be/src/features/client-cli/<app>/ (every folder there is a declared client cli),
//                         and be/apps/<app>/ tracks package.json (that name, that bin on dist/apps/<app>/src/main.js, not private,
//                         files holding dist, a version, every dependency one the app root pins at the same version) and
//                         tsconfig.build.json (it emits into dist/ the import closure of src/main.ts alone).
// Where a command is declared and that every command has its unit spec beside it are eslint-be's (cli-command-shape, and
// unit-test-colocated over ruleParams.be.unitRoles); what a client cli may import is eslint-be's cli-client-boundary (R398).
// Paths are app-relative; the cli apps and the cli feature roots are read from the slot manifest through the resolver.
import { found, readJson, readText } from './read.mjs';
import type { Parsed, Repo, Resolver } from './rule-types.mjs';

const CLI_REQUIRED = 'BE_CLI_REQUIRED';
const CLI_CLIENT = 'BE_CLI_CLIENT';

/** The one name of the ops cli app, its kind, and what its image is called below it. */
const CLI_APP = 'cli';
const CLI_KIND = 'cli';
const IMAGE = 'Dockerfile';
const CLI_FEATURE_SLOT = 'be.cli';
const CLI_APP_SLOT = 'be.app.cli';
/** The kind of a client cli, the slot of its feature root, and the files of its npm package beside its source. */
const CLIENT_KIND = 'client-cli';
const CLIENT_FEATURE_SLOT = 'be.client-cli';
const CLIENT_MANIFEST = 'package.json';
const CLIENT_BUILD = 'tsconfig.build.json';
const CLIENT_OUT = 'dist';
const ROOT_MANIFEST = 'package.json';

/** The entry of a client cli inside its package: the compiled main of its app under the package's own dist. */
export const clientCliEntry = (app: string): string => `${CLIENT_OUT}/apps/${app}/src/main.js`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A path of package.json `files` or `bin` without its leading `./` and trailing `/`. */
const plain = (value: unknown): string => String(value).replace(/^\.\//, '').replace(/\/+$/, '');

/** The class names of the commands one cli feature root declares (`export class X` of a .cli.ts beside an `@Command` or `@SubCommand`), each with its files. */
function commandClasses(repoRoot: string, commandFiles: readonly string[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const file of commandFiles.filter((each) => each.endsWith('.cli.ts') && !each.endsWith('.spec.ts'))) {
    const text = readText(repoRoot, `be/${file}`) ?? '';
    if (!/@(?:Sub)?Command\(/u.test(text)) continue;
    for (const match of text.matchAll(/^export class (\w+)/gmu)) byName.set(match[1]!, [...(byName.get(match[1]!) ?? []), `be/${file}`]);
  }
  return byName;
}

/** R149 over one cli feature root: no two of its command classes share a class name. */
function commandNameFindings(repoRoot: string | undefined, commandFiles: readonly string[]) {
  const findings = [];
  if (repoRoot === undefined) return [];
  for (const [name, owners] of commandClasses(repoRoot, commandFiles)) {
    if (owners.length < 2) continue;
    for (const file of owners) findings.push(found('BE_CLI_COMMAND_SHAPE', file, `the command class ${name} is declared by ${owners.join(' and ')}: nest-commander matches a sub-command by its class name, so one of them runs the other's action; give each its own name, such as <Group>RunCli (BE-CLI-2, R149)`, { name }));
  }
  return findings;
}

/** R147 over the declared apps: the one ops cli, required by a connection or a tracked ops command, with its image; R149 over its feature root. */
function opsFindings({ be, onBe, tracked, beResolver, repoRoot }: { be: Parsed; onBe: string[]; tracked: Set<string>; beResolver: Resolver; repoRoot: string | undefined }) {
  const commandFiles = onBe.filter((file: string) => beResolver.classifyPath(file).slot === CLI_FEATURE_SLOT);
  const findings = [];
  const cliApps = be.apps.filter((app: Parsed) => app.kind === CLI_KIND);
  // Where the cli app is only optional (litePresence: schema migration is `starci app db migrate`'s job) a connection no longer forces it; a tracked command still does.
  const migrates = (be.connections ?? []).length > 0 && beResolver.slot(CLI_APP_SLOT)?.presence !== 'optional';
  const needs = migrates || commandFiles.length > 0;
  let why = 'it tracks commands under be/src/features/cli/';
  if (migrates) {
    const plural = be.connections.length === 1 ? '' : 's';
    why = `it declares the connection${plural} ${be.connections.map((c: Parsed) => c.name).join(', ')} (their migrations run as \`cli migrate run\`)`;
  }
  if (needs && cliApps.length === 0) findings.push(found(CLI_REQUIRED, 'hfs.json', `the back end declares no ops cli app, but ${why}; declare { "name": "${CLI_APP}", "kind": "${CLI_KIND}" } in sides.be.apps and build be/apps/${CLI_APP} on nest-commander: every one-off action of the back end is one of its commands.`, { needs: why }));
  for (const app of cliApps.filter((entry: Parsed) => entry.name !== CLI_APP)) findings.push(found(CLI_REQUIRED, 'hfs.json', `the app ${app.name} is of kind ${CLI_KIND}; the back end has ONE ops cli app, be/apps/${CLI_APP}, so its image and its command line are the same in every app. A command line a user installs is an app of kind ${CLIENT_KIND}.`, { app: app.name }));
  if (cliApps.length > 0 && !tracked.has(`apps/${CLI_APP}/${IMAGE}`) && cliApps.some((app: Parsed) => app.name === CLI_APP)) findings.push(found(CLI_REQUIRED, `be/apps/${CLI_APP}/${IMAGE}`, `be/apps/${CLI_APP} has no image: track be/apps/${CLI_APP}/${IMAGE}, the one cli image every one-off action runs from (\`cli <group> <command>\`).`, { app: CLI_APP }));
  findings.push(...commandNameFindings(repoRoot, commandFiles));
  return findings;
}

/** R397 over hfs.json: `package` and `bin` on every client cli and on no other app, each used once. */
function clientDeclarationFindings(be: Parsed) {
  const findings = [];
  const seen = new Map<string, string>();
  for (const app of be.apps) {
    const client = app.kind === CLIENT_KIND;
    for (const field of ['package', 'bin']) {
      const value = app[field];
      if (client && value === undefined) findings.push(found(CLI_CLIENT, 'hfs.json', `the client cli ${app.name} declares no \`${field}\`; a client cli is { "name": "${app.name}", "kind": "${CLIENT_KIND}", "package": "<npm name>", "bin": "<command>" }: the npm package it is published as and the command it installs.`, { app: app.name, field }));
      if (!client && value !== undefined) findings.push(found(CLI_CLIENT, 'hfs.json', `the app ${app.name} (kind ${app.kind}) declares \`${field}\`; only a client cli (kind ${CLIENT_KIND}) is published as an npm package with a command.`, { app: app.name, field }));
      if (!client || value === undefined) continue;
      const key = `${field}:${value}`;
      if (seen.has(key)) findings.push(found(CLI_CLIENT, 'hfs.json', `the client clis ${seen.get(key)} and ${app.name} declare the same \`${field}\` ${value}; each client cli is its own package with its own command.`, { app: app.name, field }));
      else seen.set(key, app.name);
    }
  }
  return findings;
}

/** R397 over the feature roots: every client cli has its own, and every folder of be/src/features/client-cli/ is a declared client cli; R149 over each root. */
function clientRootFindings({ clients, onBe, beResolver, repoRoot }: { clients: Parsed[]; onBe: string[]; beResolver: Resolver; repoRoot: string | undefined }) {
  const findings = [];
  const filesOf = new Map<string, string[]>();
  for (const file of onBe) {
    const place = beResolver.classifyPath(file);
    if (place.slot === CLIENT_FEATURE_SLOT && place.bindings?.client !== undefined) filesOf.set(place.bindings.client, [...(filesOf.get(place.bindings.client) ?? []), file]);
  }
  const roots = new Set(filesOf.keys());
  for (const commandFiles of filesOf.values()) findings.push(...commandNameFindings(repoRoot, commandFiles));
  const declared = new Set(clients.map((app: Parsed) => app.name));
  for (const app of clients) {
    if (!roots.has(app.name)) findings.push(found(CLI_CLIENT, `be/src/features/${CLIENT_KIND}/${app.name}/`, `the client cli ${app.name} has no feature root: its commands live in be/src/features/${CLIENT_KIND}/${app.name}/ (index.ts exporting its module, <group>/<group>.cli.ts, <group>/subs/<name>.cli.ts), never in the ops root be/src/features/cli/.`, { app: app.name }));
  }
  for (const root of [...roots].filter((name) => !declared.has(name)).sort()) findings.push(found(CLI_CLIENT, `be/src/features/${CLIENT_KIND}/${root}/`, `be/src/features/${CLIENT_KIND}/${root}/ belongs to no declared client cli; a folder there is named after an app of kind ${CLIENT_KIND} of hfs.json sides.be.apps (${[...declared].sort().join(', ') || 'none declared'}).`, { root }));
  return findings;
}

/** What is wrong with the package.json of one client cli against its declaration and the app root's pins. */
function manifestProblems(app: Parsed, manifest: Record<string, unknown>, rootPins: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const entry = clientCliEntry(app.name);
  if (app.package !== undefined && manifest.name !== app.package) bad.push(`its name is ${JSON.stringify(manifest.name)}; hfs.json declares the package ${app.package}`);
  const bin = manifest.bin;
  if (app.bin !== undefined && !(isRecord(bin) && Object.keys(bin).length === 1 && plain(bin[app.bin]) === entry)) bad.push(`its bin is ${JSON.stringify(bin)}; hfs.json declares the command ${app.bin}, so bin is { "${app.bin}": "${entry}" }`);
  if (manifest.private === true) bad.push('it is private; a client cli is published to npm');
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)) bad.push('it has no semver version');
  if (!(Array.isArray(manifest.files) && manifest.files.some((item) => plain(item) === CLIENT_OUT))) bad.push(`its files do not hold ${CLIENT_OUT}; the package ships its compiled ${CLIENT_OUT}/ and nothing of the source tree`);
  const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {};
  for (const [name, version] of Object.entries(dependencies)) {
    if (rootPins[name] === undefined) bad.push(`it depends on ${name}, which the app root's package.json does not pin`);
    else if (rootPins[name] !== version) bad.push(`it depends on ${name}@${String(version)}; the app root pins ${String(rootPins[name])}`);
  }
  return bad;
}

/** What is wrong with the tsconfig.build.json of one client cli: it emits into its own dist/ the closure of its main alone. */
function buildProblems(config: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const options = isRecord(config.compilerOptions) ? config.compilerOptions : {};
  if (plain(options.outDir) !== CLIENT_OUT) bad.push(`compilerOptions.outDir is ${JSON.stringify(options.outDir)}, not "./${CLIENT_OUT}"`);
  if (plain(options.rootDir) !== '../..') bad.push(`compilerOptions.rootDir is ${JSON.stringify(options.rootDir)}, not "../.." (the be side, so ${CLIENT_OUT}/ keeps the side's layout)`);
  if (!(Array.isArray(config.files) && config.files.length === 1 && plain(config.files[0]) === 'src/main.ts')) bad.push('files is not ["src/main.ts"]');
  if (!(Array.isArray(config.include) && config.include.length === 0)) bad.push('include is not []: the build emits the import closure of main.ts and nothing else');
  return bad;
}

/** R397 over be/apps/<app>/ of every client cli: its package.json and tsconfig.build.json. */
function clientPackageFindings({ clients, tracked, repoRoot }: { clients: Parsed[]; tracked: Set<string>; repoRoot: string | undefined }) {
  const findings = [];
  const root = repoRoot === undefined ? null : readJson(repoRoot, ROOT_MANIFEST);
  const rootPins: Record<string, unknown> = isRecord(root?.dependencies) ? root.dependencies : {};
  for (const app of clients) {
    const folder = `be/apps/${app.name}`;
    const manifestPath = `${folder}/${CLIENT_MANIFEST}`;
    const buildPath = `${folder}/${CLIENT_BUILD}`;
    if (!tracked.has(`apps/${app.name}/${CLIENT_MANIFEST}`)) findings.push(found(CLI_CLIENT, manifestPath, `the client cli ${app.name} has no ${manifestPath}: the manifest it is published with (name ${app.package ?? '<package>'}, bin { "${app.bin ?? '<bin>'}": "${clientCliEntry(app.name)}" }, files ["${CLIENT_OUT}"], a version, its runtime dependencies at the app root's pins).`, { app: app.name }));
    else if (repoRoot !== undefined) {
      const manifest = readJson(repoRoot, manifestPath);
      const problems = isRecord(manifest) ? manifestProblems(app, manifest, rootPins) : ['it is not a JSON object'];
      for (const problem of problems) findings.push(found(CLI_CLIENT, manifestPath, `${manifestPath}: ${problem}.`, { app: app.name }));
    }
    if (!tracked.has(`apps/${app.name}/${CLIENT_BUILD}`)) findings.push(found(CLI_CLIENT, buildPath, `the client cli ${app.name} has no ${buildPath}: the build of its package (extends ../../tsconfig.build.json, outDir ./${CLIENT_OUT}, rootDir ../.., files ["src/main.ts"], include []), which \`npm run build:${app.name}\` runs.`, { app: app.name }));
    else if (repoRoot !== undefined) {
      const config = readJson(repoRoot, buildPath);
      const problems = isRecord(config) ? buildProblems(config) : ['it is not a JSON object'];
      for (const problem of problems) findings.push(found(CLI_CLIENT, buildPath, `${buildPath}: ${problem}.`, { app: app.name }));
    }
  }
  return findings;
}

/** The findings of R147, R149 and R397 over the tracked paths `files` (app-relative) of the app `repo` at `repoRoot`; `resolver` is the app's. */
export function cliFindings({ repoRoot, files, repo, resolver }: { repoRoot?: string; files: string[]; repo: Repo; resolver: Resolver }) {
  if (!repo?.sides) return [];
  const be = repo.sides.be;
  const beResolver = resolver.sides?.be ?? resolver;
  const onBe = files.filter((file: string) => file.startsWith('be/')).map((file: string) => file.slice('be/'.length));
  const tracked = new Set(onBe);
  const clients = be.apps.filter((app: Parsed) => app.kind === CLIENT_KIND);
  return [
    ...opsFindings({ be, onBe, tracked, beResolver, repoRoot }),
    ...clientDeclarationFindings(be),
    ...clientRootFindings({ clients, onBe, beResolver, repoRoot }),
    ...clientPackageFindings({ clients, tracked, repoRoot }),
  ];
}
