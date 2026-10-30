// test-world.mjs - the test world of a full app: the declaration of @starci/test-world under be/src/tests/world/ and one baseline
// real spec per world layer, rendered from templates/be/test-world/ for the api apps and connections hfs.json declares.
//
// A full app's release gate runs integration, e2e and contract (the managed test:* scripts), and the jest preset gives those
// projects only to an app that has be/src/tests/world/global-setup.ts. The scaffold writes these files into every new full app,
// and `starci app upgrade` adds the missing ones to an existing full app (never overwriting a file the app already has):
//   - world/: the declaration (stack .starcistacks/dev, Postgres per connection, the api apps, the cli app's migration runner as
//     the migrate step, a platform base for modules worlds), its spec entry and the library's global setup and teardown;
//   - integration/readiness/: the readiness probe over the real database, ready, refused while the database is cut, ready again;
//   - e2e/system-health/<app>-serves-once-migrated: each api app booted over the migrated database and called over HTTP;
//   - fixtures/persistence/migrations.sql.ts: the ledger reads the e2e asserts.
// The contract layer is the app's own contract spec the be skeleton already ships (src/tests/contract/http-security/).
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES_DIR } from '../sync/index.mjs';
import { ScaffoldError, camelOf, pascalOf } from './service.mjs';

/** A connection of the be side of a full declaration. */
interface WorldConnection {
  readonly name: string;
  readonly envPrefix: string;
  readonly owner?: string;
}

/** An app of the be side. */
interface WorldBeApp {
  readonly name: string;
  readonly kind: string;
}

/** The part of a resolved full declaration the test world reads. */
export interface WorldDeclaration {
  readonly sides: { readonly be: { readonly apps: readonly WorldBeApp[]; readonly connections?: readonly WorldConnection[] } };
}

/** The apps to boot and the connections to migrate. */
interface WorldShape {
  readonly apis: readonly WorldBeApp[];
  readonly connections: readonly WorldConnection[];
}

const TEMPLATE_DIR = path.join(TEMPLATES_DIR, 'be', 'test-world');
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/** The file the jest preset reads to give an app its world projects; its presence means the app has a test world. */
export const WORLD_MARKER = 'be/src/tests/world/global-setup.ts';

const template = (file: string) => fs.readFileSync(path.join(TEMPLATE_DIR, ...file.split('/')), 'utf8').replace(/\r\n/g, '\n');

/** A template with its `{{name}}` slots filled; every slot must have a value and every value must be used. */
function fill(file: string, values: Readonly<Record<string, string>>): string {
  const used = new Set<string>();
  const text = template(file).replace(/\{\{([A-Za-z]+)\}\}/gu, (_: string, key: string) => {
    if (!Object.hasOwn(values, key)) throw new ScaffoldError('HFS_SCAFFOLD_TEMPLATE_VARIABLE', `templates/be/test-world/${file} names {{${key}}}, which has no value`);
    used.add(key);
    return values[key]!; // hasOwn above
  });
  const unused = Object.keys(values).filter((key) => !used.has(key));
  if (unused.length) throw new ScaffoldError('HFS_SCAFFOLD_TEMPLATE_VARIABLE', `templates/be/test-world/${file} does not use ${unused.join(', ')}`);
  return text;
}

/** `.name` for an identifier, `["name"]` otherwise: how a spec reads a record key. */
const access = (name: string) => (IDENTIFIER.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`);
const constantOf = (name: string) => name.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase();
const union = (names: readonly string[]) => names.map((name) => JSON.stringify(name)).join(' | ');
const migrationsConst = (connection: WorldConnection) => `${constantOf(connection.name)}_APPLIED_MIGRATIONS`;

/** The api apps and connections of a full declaration, refused when the world has nothing to boot or migrate. */
function worldShape(app: WorldDeclaration): WorldShape {
  const apis = app.sides.be.apps.filter((entry) => entry.kind === 'api');
  const connections = app.sides.be.connections ?? [];
  if (!apis.length) throw new ScaffoldError('HFS_SCAFFOLD_TEST_WORLD', 'the test world boots the api apps of hfs.json, and it declares none');
  if (!connections.length) throw new ScaffoldError('HFS_SCAFFOLD_TEST_WORLD', 'the test world migrates the connections of hfs.json, and it declares none');
  if (!app.sides.be.apps.some((entry) => entry.kind === 'cli' && entry.name === 'cli')) throw new ScaffoldError('HFS_SCAFFOLD_TEST_WORLD', 'the test world migrates through the cli app (be/apps/cli), and hfs.json declares none');
  return { apis, connections };
}

function worldConfig({ apis, connections }: WorldShape): string {
  return fill('world/test-world.config.ts.tpl', {
    appModuleImports: apis.map((api) => `import { AppModule as ${pascalOf(api.name)}App } from "../../../apps/${api.name}/src/app.module"`).join('\n'),
    optionsImports: ['cliOptionsOf', ...apis.map((api) => `${camelOf(api.name)}OptionsOf`), 'migrateCli', 'platformBase'].sort().join(', '),
    connectionDeclarations: connections.map((connection) => `{ name: ${JSON.stringify(connection.name)} }`).join(', '),
    worldApps: apis.map((api) => `        ${IDENTIFIER.test(api.name) ? api.name : JSON.stringify(api.name)}: { module: ${pascalOf(api.name)}App, options: ${camelOf(api.name)}OptionsOf, configure: applyCorrelation },`).join('\n'),
  });
}

function worldOptions({ apis, connections }: WorldShape): string {
  const appOptions = apis.map((api) => [
    '',
    `/** The ${api.name} app, read the way its \`main.ts\` reads its environment, listening on the port the run reserved for it. */`,
    `export const ${camelOf(api.name)}OptionsOf = (w: AppWiring): ${pascalOf(api.name)}Options =>`,
    `    read${pascalOf(api.name)}Env(environmentOf(w, { PORT: String(w.apps${access(api.name)}.port) }))`,
    '',
  ].join('\n')).join('');
  return fill('world/test-apps.options.ts.tpl', {
    appEnvImports: apis.flatMap((api) => [
      `import { read${pascalOf(api.name)}Env } from "../../../apps/${api.name}/src/${api.name}.env"`,
      `import type { ${pascalOf(api.name)}Options } from "../../../apps/${api.name}/src/${api.name}.options"`,
    ]).join('\n'),
    appsUnion: union(apis.map((api) => api.name)),
    connectionsUnion: union(connections.map((connection) => connection.name)),
    environmentConnections: connections.map((connection) => `        ${connection.envPrefix}_URL: w.db${access(connection.name)}.url,`).join('\n'),
    appOptions,
  });
}

function migrationsFixture({ connections }: Pick<WorldShape, 'connections'>): string {
  return fill('fixtures/migrations.sql.ts.tpl', {
    migrationQueries: connections.map((connection) => [
      '',
      `/** The migrations the run applied to the ${connection.name} connection ($none), oldest first: the ledger the cli migrate step writes. */`,
      `export const ${migrationsConst(connection)} = sql\`SELECT name FROM ${connection.name}_migrations ORDER BY id LIMIT 500\``,
      '',
    ].join('\n')).join(''),
  });
}

/** The connection an api app's e2e reads back: the one it owns, else the first declared. */
const connectionOf = (api: WorldBeApp, connections: readonly WorldConnection[]): WorldConnection => connections.find((connection) => connection.owner === api.name) ?? connections[0]!; // worldShape refuses an empty list

function e2eSpec(api: WorldBeApp, connections: readonly WorldConnection[]): string {
  const connection = connectionOf(api, connections);
  return fill('e2e/serves-once-migrated.e2e-spec.ts.tpl', {
    app: api.name,
    appAccess: access(api.name),
    connection: connection.name,
    connectionAccess: access(connection.name),
    migrationsConst: migrationsConst(connection),
  });
}

/**
 * The test world files of the full app `app` (a resolved hfs declaration): [{ path, content }], app-relative, in a fixed order.
 * Refused (HFS_SCAFFOLD_TEST_WORLD) when the declaration has no api app, no connection or no cli app to migrate through.
 */
export function testWorldFiles(app: WorldDeclaration): Array<{ path: string, content: string }> {
  const shape = worldShape(app);
  return [
    { path: 'be/src/tests/world/test-world.config.ts', content: worldConfig(shape) },
    { path: 'be/src/tests/world/test-apps.options.ts', content: worldOptions(shape) },
    { path: 'be/src/tests/world/use-test-world.ts', content: fill('world/use-test-world.ts.tpl', {}) },
    { path: WORLD_MARKER, content: fill('world/global-setup.ts.tpl', {}) },
    { path: 'be/src/tests/world/global-teardown.ts', content: fill('world/global-teardown.ts.tpl', {}) },
    { path: 'be/src/tests/fixtures/persistence/migrations.sql.ts', content: migrationsFixture(shape) },
    { path: 'be/src/tests/integration/readiness/readiness.integration-spec.ts', content: fill('integration/readiness.integration-spec.ts.tpl', {}) },
    ...shape.apis.map((api) => ({ path: `be/src/tests/e2e/system-health/${api.name}-serves-once-migrated.e2e-spec.ts`, content: e2eSpec(api, shape.connections) })),
  ];
}
