import fs from "node:fs";
import path from "node:path";
import {
  loadSlotManifest,
  readRepoDeclaration,
} from "../runtime/scripts/hfs/slots.mjs";
import { render, TEMPLATES_DIR } from "../sync/index.mjs";
import { ScaffoldError, pascalOf } from "./service.mjs";
import { filesBelow, registerLiteDomainService, registerLiteExports, registrationFiles } from "./lite-exports.mjs";
import { byCodeUnit } from "../report/order.mjs";
import { coreFeApps, ENTITY_BASE_FILE } from "./app.mjs";
import { addModuleImport, planComposeGroup } from "./add-compose.mjs";
import { withSqlIdentifierError } from "./add-database-lite.mjs";

/** A file the table verb writes: app-relative path and body. */
interface FileBody {
  readonly relative: string;
  readonly body: string;
}

/** A composition file or app module the verb rewrites (planComposeGroup answers `exists` for a group file). */
interface ComposePatch {
  readonly relative: string;
  readonly text: string;
  readonly exists?: boolean | undefined;
}

/** A declared app of a side. */
interface DeclaredApp {
  readonly name: string;
  readonly kind: string;
}

/** The back-end connection a table lands on. */
interface TableConnection {
  readonly provider?: string;
  readonly owner?: string;
}

/** The part of the app declaration the table verb reads. */
interface TableRepo {
  readonly edition?: string | undefined;
  readonly sides?: {
    readonly be?: { readonly apps: readonly DeclaredApp[]; readonly connections?: readonly TableConnection[] };
    readonly fe?: { readonly apps?: readonly DeclaredApp[] };
  };
}

/** The variables the table templates are filled with. */
type TableValues = {
  name: string;
  table: string;
  tableSql: string;
  Name: string;
  nameCamel: string;
  upper: string;
  singular: string;
  Singular: string;
  singularCamel: string;
  singularUpper: string;
};

/** Applies a change to the text of an app-relative file, remembering its first bytes for rollback. */
type Edit = (relative: string, change: (text: string) => string) => void;

/** What a table verb call is resolved to before anything is planned. */
interface TableContext {
  readonly root: string;
  readonly name: string;
  readonly requestedName: string;
  readonly feature: string;
  readonly table: string;
  readonly repo: TableRepo;
  readonly connection: TableConnection;
}

const NAME = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
const MIGRATION = /^(\d{14})_[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.sql$/;
const POSTGRES_RESERVED = new Set([
  "all",
  "analyse",
  "analyze",
  "and",
  "any",
  "array",
  "as",
  "asc",
  "asymmetric",
  "authorization",
  "binary",
  "both",
  "case",
  "cast",
  "check",
  "collate",
  "collation",
  "column",
  "concurrently",
  "constraint",
  "create",
  "cross",
  "current_catalog",
  "current_date",
  "current_role",
  "current_schema",
  "current_time",
  "current_timestamp",
  "current_user",
  "default",
  "deferrable",
  "desc",
  "distinct",
  "do",
  "else",
  "end",
  "except",
  "false",
  "fetch",
  "for",
  "foreign",
  "freeze",
  "from",
  "full",
  "grant",
  "group",
  "having",
  "ilike",
  "in",
  "initially",
  "inner",
  "intersect",
  "into",
  "is",
  "isnull",
  "join",
  "lateral",
  "leading",
  "left",
  "like",
  "limit",
  "localtime",
  "localtimestamp",
  "natural",
  "not",
  "notnull",
  "null",
  "nulls",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "outer",
  "overlaps",
  "placing",
  "primary",
  "references",
  "returning",
  "right",
  "select",
  "session_user",
  "similar",
  "some",
  "symmetric",
  "system_user",
  "table",
  "tablesample",
  "then",
  "to",
  "trailing",
  "true",
  "union",
  "unique",
  "user",
  "using",
  "variadic",
  "verbose",
  "when",
  "where",
  "window",
  "with",
]);

const timestampOf = (now: () => number) =>
  new Date(now()).toISOString().replace(/\D/g, "").slice(0, 14);
const snakeOf = (name: string) => name.replaceAll("-", "_");
const featureOf = (name: string) => name.replaceAll("_", "-");
const sqlIdentifierOf = (name: string) =>
  POSTGRES_RESERVED.has(name) ? `"${name}"` : name;
const singularOf = (name: string) => (name.endsWith("s") ? name.slice(0, -1) : name);
const camelOf = (name: string) => {
  const pascal = pascalOf(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

function template(relative: string, values: Readonly<Record<string, string>>): string {
  const file = path.join(TEMPLATES_DIR, ...relative.split("/"));
  if (!fs.existsSync(file))
    throw new ScaffoldError(
      "HFS_ADD_TEMPLATE_MISSING",
      `table template ${relative} is not carried by this package`,
    );
  return fs
    .readFileSync(file, "utf8")
    .replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (whole: string, key: string) => {
      const value = values[key];
      if (value === undefined)
        throw new ScaffoldError(
          "HFS_ADD_PLACEHOLDER_UNKNOWN",
          `table template ${relative} uses ${whole}, which add table does not provide`,
        );
      return value;
    });
}

function removeEmptyParents(file: string, stop: string): void {
  for (
    let at = path.dirname(file);
    at.startsWith(stop) && at !== stop;
    at = path.dirname(at)
  ) {
    if (!fs.existsSync(at) || fs.readdirSync(at).length !== 0) break;
    fs.rmdirSync(at);
  }
}

/** The app-root relative path of a file under the app (posix). */
const at = (root: string, relative: string) => path.join(root, ...relative.split("/"));

/** A line that opens the error kinds array of the errors registration. */
const KINDS_LINE = /^\s*kinds: \[$/;

/**
 * The composition file of an api app that holds its error kinds array: the root `app.module.ts`, or else the composition group
 * `compose/<area>.ts` of the same app that holds it (the platform group of a scaffolded app). Repository-relative.
 */
function kindsHomeOf(root: string, appRelative: string): string {
  const holdsKinds = (relative: string) => fs.readFileSync(at(root, relative), "utf8").replace(/\r\n/g, "\n").split("\n").some((line) => KINDS_LINE.test(line));
  if (holdsKinds(appRelative)) return appRelative;
  const composeRelative = `${path.posix.dirname(appRelative)}/compose`;
  const groups = fs.existsSync(at(root, composeRelative)) ? fs.readdirSync(at(root, composeRelative)).filter((file) => file.endsWith(".ts")).sort(byCodeUnit) : [];
  const home = groups.map((file) => `${composeRelative}/${file}`).find(holdsKinds);
  if (!home) throw new ScaffoldError("HFS_ADD_WIRE_INVALID", `add table could not find the error kinds array in ${appRelative} or a group of its compose/`);
  return home;
}

/** A composition group after `kinds` is listed first in its error kinds array and imported from `specifier`. Returns the new text. */
function wireKinds(text: string, relative: string, { kinds, specifier }: { kinds: string, specifier: string }): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.some((line) => line.startsWith("import ") && new RegExp(String.raw`\b${kinds}\b`).test(line))) return text;
  const lastImport = lines.reduce((last, line, index) => (line.startsWith("import ") ? index : last), -1);
  const kindsAt = lines.findIndex((line) => KINDS_LINE.test(line));
  if (lastImport < 0 || kindsAt < 0) throw new ScaffoldError("HFS_ADD_WIRE_INVALID", `add table could not find the error kinds array in ${relative}`);
  const kindsIndent = /^(\s*)/.exec(lines[kindsAt] ?? "")?.[1] ?? "";
  lines.splice(kindsAt + 1, 0, `${kindsIndent}    ${kinds},`);
  lines.splice(lastImport + 1, 0, `import { ${kinds} } from "${specifier}"`);
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Plans the domain and API area groups of the connection owner, keeping registrations out of app.module.ts. */
function tableComposition({ root, repo, owner, feature, fe, ownerRelative }: { root: string, repo: TableRepo, owner: DeclaredApp, feature: string, fe: boolean, ownerRelative: string }): ComposePatch[] {
  const domain = { importLine: `import { ${pascalOf(feature)}Module } from "@modules/domain/${feature}"`, entry: `${pascalOf(feature)}Module.register({ isGlobal: true })` };
  const groups: Array<[string, Array<{ importLine: string, entry: string }>]> = [['domain', [domain]]];
  if (fe) groups.push(['api', [
    { importLine: 'import { GraphqlModule } from "@modules/platform/graphql"', entry: 'GraphqlModule.register({ isGlobal: true })' },
    { importLine: `import { ${pascalOf(feature)}GraphqlModule } from "@features/api/${feature}"`, entry: `${pascalOf(feature)}GraphqlModule.register({})` },
  ]]);
  const lines = fs.readFileSync(at(root, ownerRelative), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const patches: ComposePatch[] = groups.map(([area, entries]) => {
    const argument = area === 'domain' && repo.edition === 'lite' ? 'verifyAccessToken' : '';
    addModuleImport(lines, { importLine: `import { ${area}Modules } from "./compose/${area}"`, entry: `...${area}Modules(${argument})`, relative: ownerRelative, noun: 'table' });
    return planComposeGroup({ repoRoot: root, repo, app: owner.name, area, noun: 'table', entries });
  });
  patches.push({ relative: ownerRelative, text: lines.join('\n') });
  return patches;
}

/** The platform GraphQL server capability (templates/be/platform/graphql), whole or absent: written once, by the first GraphQL feature. */
const GRAPHQL_PLATFORM = "be/src/modules/platform/graphql";
/** The GraphQL error formatter the errors capability owns (BE_ERROR_MASKED: the registration passes platform/errors' formatter). */
const ERRORS_PLATFORM = "be/src/modules/platform/errors";
/** Every file the first GraphQL feature writes: platform/graphql whole and the GraphQL formatter of platform/errors. */
const GRAPHQL_PLATFORM_TREES: ReadonlyArray<readonly [string, string]> = [
  ["graphql", GRAPHQL_PLATFORM],
  ["errors-graphql", ERRORS_PLATFORM],
];
export const graphqlPlatformFiles = (): FileBody[] =>
  GRAPHQL_PLATFORM_TREES.flatMap(([templates, target]) => {
    const dir = path.join(TEMPLATES_DIR, "be", "platform", templates);
    return fs.readdirSync(dir).sort().map((file) => ({
      relative: `${target}/${file}`,
      body: fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n"),
    }));
  });

/**
 * The fe GraphQL transport of one product app (templates/fe/transport/graphql/clients): the auth and no-auth Apollo clients,
 * their link chain and the GraphQLResponse mapping, whole or absent, written once by the first GraphQL operation of the app,
 * as platform/graphql is on the back end. A new app has no operation, so it carries no client.
 */
const feTransportFiles = (app: string): FileBody[] => {
  const dir = path.join(TEMPLATES_DIR, "fe", "transport", "graphql", "clients");
  return filesBelow(dir)
    .map((file) => path.relative(dir, file).split(path.sep).join("/"))
    .sort(byCodeUnit)
    .map((rel) => ({
      relative: `fe/apps/${app}/src/modules/api/graphql/clients/${rel}`,
      body: fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8").replace(/\r\n/g, "\n"),
    }));
};

/** The env reader the transport's http link calls (modules/config, the app's one process.env reader), added with the transport. */
const GRAPHQL_URL_READER = [
  "/** The back end's GraphQL endpoint, the terminal link of modules/api; throws when `NEXT_PUBLIC_GRAPHQL_URL` is not set. */",
  'export const graphqlUrl = (): string => required("NEXT_PUBLIC_GRAPHQL_URL", process.env.NEXT_PUBLIC_GRAPHQL_URL)',
].join("\n");

/** An app's modules/config text with graphqlUrl appended once. */
const withGraphqlUrl = (text: string) =>
  /^export const graphqlUrl\b/m.test(text) ? text : `${text.trimEnd()}\n${GRAPHQL_URL_READER}\n`;

/** The be api feature of a table (owner ruling 2026-10-13, lite = full): get-<singular> and create-<singular> over GraphQL. */
const apiFeatureFiles = (values: TableValues): FileBody[] => {
  const base = `be/src/features/api/${values.name}`;
  const get = `get-${values.singular}`;
  const create = `create-${values.singular}`;
  const files: Array<[string, string]> = [
    [`${base}/index.ts`, "feature.index.ts.tpl"],
    [`${base}/${values.name}.options.ts`, "feature.options.ts.tpl"],
    [`${base}/${values.name}.module-definition.ts`, "feature.module-definition.ts.tpl"],
    [`${base}/${values.name}.module.ts`, "feature.module.ts.tpl"],
    [`${base}/application/${get}.query.ts`, "get.query.ts.tpl"],
    [`${base}/application/${get}.handler.ts`, "get.handler.ts.tpl"],
    [`${base}/application/${get}.contracts.ts`, "get.contracts.ts.tpl"],
    [`${base}/application/${create}.command.ts`, "create.command.ts.tpl"],
    [`${base}/application/${create}.handler.ts`, "create.handler.ts.tpl"],
    [`${base}/application/${create}.contracts.ts`, "create.contracts.ts.tpl"],
    [`${base}/transport/graphql/${get}.resolver.ts`, "get.resolver.ts.tpl"],
    [`${base}/transport/graphql/${get}.mapper.ts`, "get.mapper.ts.tpl"],
    [`${base}/transport/graphql/dto/${get}.input.ts`, "get.input.ts.tpl"],
    [`${base}/transport/graphql/dto/${get}.type.ts`, "get.type.ts.tpl"],
    [`${base}/transport/graphql/${create}.resolver.ts`, "create.resolver.ts.tpl"],
    [`${base}/transport/graphql/${create}.mapper.ts`, "create.mapper.ts.tpl"],
    [`${base}/transport/graphql/dto/${create}.type.ts`, "create.type.ts.tpl"],
    [`${base}/transport/graphql/${values.name}-graphql.options.ts`, "graphql.options.ts.tpl"],
    [`${base}/transport/graphql/${values.name}-graphql.module-definition.ts`, "graphql.module-definition.ts.tpl"],
    [`${base}/transport/graphql/${values.name}-graphql.module.ts`, "graphql.module.ts.tpl"],
  ];
  return files.map(([relative, file]) => ({ relative, body: template(`be/table/api/${file}`, values) }));
};

/**
 * The fe data code of a table in one product app: one GraphQL operation file per operation (modules/api/graphql/{queries,
 * mutations}, its request/data types from the generated wire types) and one SWR hook per operation (hooks/swr/api/graphql).
 * Never a Server Action and never a database reader: the front end reaches data only through the back end.
 */
const feOperationFiles = (app: string, values: TableValues): FileBody[] => {
  const api = `fe/apps/${app}/src/modules/api/graphql`;
  const swr = `fe/apps/${app}/src/hooks/swr/api/graphql`;
  const files: Array<[string, string]> = [
    [`${api}/queries/query-${values.singular}.ts`, "query.ts.tpl"],
    [`${api}/queries/types/${values.singular}.ts`, "query.types.ts.tpl"],
    [`${api}/mutations/mutation-create-${values.singular}.ts`, "mutation.ts.tpl"],
    [`${api}/mutations/types/create-${values.singular}.ts`, "mutation.types.ts.tpl"],
    [`${swr}/queries/useQuery${values.Singular}Swr.ts`, "useQuerySwr.ts.tpl"],
    [`${swr}/mutations/useMutateCreate${values.Singular}Swr.ts`, "useMutateSwr.ts.tpl"],
  ];
  return files.map(([relative, file]) => ({ relative, body: template(`fe/table/graphql/${file}`, values) }));
};

/** The barrel lines that make one table's SWR hooks reachable from hooks/swr (each barrel created when absent). */
const feBarrels = (app: string, values: TableValues): Array<[string, string]> => {
  const swr = `fe/apps/${app}/src/hooks/swr`;
  return [
    [`${swr}/api/graphql/queries/index.ts`, `export { QUERY_${values.singularUpper}_SWR_KEY, useQuery${values.Singular}Swr } from "./useQuery${values.Singular}Swr"`],
    [`${swr}/api/graphql/mutations/index.ts`, `export { MUTATE_CREATE_${values.singularUpper}_SWR_KEY, useMutateCreate${values.Singular}Swr } from "./useMutateCreate${values.Singular}Swr"`],
    [`${swr}/api/graphql/index.ts`, 'export * from "./mutations"'],
    [`${swr}/api/graphql/index.ts`, 'export * from "./queries"'],
    [`${swr}/api/index.ts`, 'export * from "./graphql"'],
    // the owner's public entry names its hooks explicitly (ARCH_OWNER_EXPORT_STAR); the inner barrels may re-export whole
    [`${swr}/index.ts`, `export { QUERY_${values.singularUpper}_SWR_KEY, useQuery${values.Singular}Swr } from "./api"`],
    [`${swr}/index.ts`, `export { MUTATE_CREATE_${values.singularUpper}_SWR_KEY, useMutateCreate${values.Singular}Swr } from "./api"`],
  ];
};

/** A barrel text with `line` added once, kept in code-unit order. */
const withExport = (text: string, line: string) => {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (lines.includes(line)) return text;
  return `${[...lines, line].sort(byCodeUnit).join("\n")}\n`;
};

/**
 * Adds one db table migration and its domain capability; with `fe`, the table's api feature over GraphQL (the GraphQL
 * server capability on first use) and, in every product Next app, its operation files and SWR hooks.
 */
function tableContext({ root, name }: { root: string, name: string }): TableContext {
  const requestedName = String(name);
  if (!NAME.test(requestedName))
    throw new ScaffoldError(
      "HFS_ADD_NAME_INVALID",
      `table name ${name} must use lowercase letters, digits and single dash or underscore separators`,
    );
  const feature = featureOf(requestedName);
  const table = snakeOf(requestedName);
  const manifest = loadSlotManifest();
  const repo = readRepoDeclaration(manifest, root);
  const connection = repo.sides?.be?.connections?.find((candidate: TableConnection) => candidate.provider === "postgres");
  if (!connection) {
    throw new ScaffoldError(
      "HFS_ADD_TABLE_PROVIDER",
      "add table needs a back-end connection whose provider is postgres",
    );
  }

  return { root, name, requestedName, feature, table, repo, connection };
}

function nextMigration({ root, feature, requestedName, now }: { root: string, feature: string, requestedName: string, now: () => number }): string {
  const migrationsDir = path.join(root, "db", "migrations");
  const migrations = fs.existsSync(migrationsDir)
    ? fs
        .readdirSync(migrationsDir)
        .filter((file) => MIGRATION.test(file))
        .sort(byCodeUnit)
    : [];
  if (migrations.some((file) => file.endsWith(`_${feature}.sql`)))
    throw new ScaffoldError(
      "HFS_ADD_EXISTS",
      `table ${requestedName} already has a migration`,
    );
  const stamp = timestampOf(now);
  const latest = migrations.at(-1)?.slice(0, 14);
  if (latest && stamp <= latest)
    throw new ScaffoldError(
      "HFS_ADD_MIGRATION_ORDER",
      `the current UTC timestamp ${stamp} is not later than the latest migration ${latest}; fix the clock or wait for the next second`,
    );

  return stamp;
}

function tableValues({ feature, table }: { feature: string, table: string }): TableValues {
  const singular = singularOf(feature);
  const values: TableValues = {
    name: feature,
    table,
    tableSql: sqlIdentifierOf(table),
    Name: pascalOf(feature),
    nameCamel: camelOf(feature),
    upper: table.toUpperCase(),
    singular,
    Singular: pascalOf(singular),
    singularCamel: camelOf(singular),
    singularUpper: snakeOf(singular).toUpperCase(),
  };
  return values;
}

function productApps(repo: TableRepo, fe: boolean): DeclaredApp[] {
  const apps = fe ? coreFeApps(repo.sides?.fe?.apps ?? []) : [];
  if (fe && !apps.length)
    throw new ScaffoldError(
      "HFS_ADD_NO_FRONT_END",
      "add table --fe needs at least one declared product Next app",
    );
  return apps;
}

function tableFiles({ root, feature, stamp, values, fe, apps }: { root: string, feature: string, stamp: string, values: TableValues, fe: boolean, apps: readonly DeclaredApp[] }): FileBody[] {
  const api = fe ? ".api" : "";
  const domain = `be/src/modules/domain/${feature}`;
  const planned: FileBody[] = [
    {
      relative: `db/migrations/${stamp}_${feature}.sql`,
      body: template("be/table/migration.sql.tpl", values),
    },
    { relative: `${domain}/index.ts`, body: template("be/table/index.ts.tpl", values) },
    { relative: `${domain}/errors/${feature}.error.ts`, body: template(`be/table/error${api}.ts.tpl`, values) },
    { relative: `${domain}/${feature}.module.ts`, body: template("be/table/module.ts.tpl", values) },
    { relative: `${domain}/${feature}.module-definition.ts`, body: template("be/table/module-definition.ts.tpl", values) },
    { relative: `${domain}/${feature}.options.ts`, body: template("be/table/options.ts.tpl", values) },
    { relative: `${domain}/${feature}.service.ts`, body: template(`be/table/service${api}.ts.tpl`, values) },
    { relative: `${domain}/persistence/entities/${feature}.entity.ts`, body: template("be/table/entity.ts.tpl", values) },
    { relative: `${domain}/persistence/entities/index.ts`, body: template("be/table/entities.index.ts.tpl", values) },
  ];
  if (fe) {
    planned.push(...apiFeatureFiles(values));
    if (!fs.existsSync(at(root, `${GRAPHQL_PLATFORM}/index.ts`))) planned.push(...graphqlPlatformFiles());
    for (const app of apps) {
      if (!fs.existsSync(at(root, `fe/apps/${app.name}/src/modules/api/graphql/clients/index.ts`))) planned.push(...feTransportFiles(app.name));
      planned.push(...feOperationFiles(app.name, values));
    }
  }

  return planned;
}

function tableOwner({ root, repo, connection, name, requestedName, planned }: { root: string, repo: TableRepo, connection: TableConnection, name: string, requestedName: string, planned: readonly FileBody[] }): { owner: DeclaredApp, ownerRelative: string } {
  const clash = planned
    .filter((file) => fs.existsSync(at(root, file.relative)))
    .map((file) => file.relative);
  if (clash.length)
    throw new ScaffoldError(
      "HFS_ADD_EXISTS",
      `table ${requestedName} already exists: ${clash.join(", ")}`,
    );
  const owner = repo.sides!.be!.apps.find((app) => app.name === connection.owner && app.kind === "api");
  if (!owner)
    throw new ScaffoldError("HFS_ADD_NO_API_OWNER", `add table needs the database connection owner ${connection.owner} to be a declared api app`);
  const ownerRelative = `be/apps/${owner.name}/src/app.module.ts`;
  if (!fs.existsSync(at(root, ownerRelative)))
    throw new ScaffoldError("HFS_ADD_WIRE_MISSING", `add table registers ${name} in ${ownerRelative}, which does not exist`);

  return { owner, ownerRelative };
}

function tableEditor(root: string, touched: Map<string, Buffer | null>): Edit {
  const edit: Edit = (relative, change) => {
    const file = at(root, relative);
    if (!touched.has(file)) touched.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const after = change(before);
    if (after === before) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, after);
  };
  return edit;
}

function writeTableFiles({ root, planned }: { root: string, planned: readonly FileBody[] }, created: string[]): void {
  for (const file of planned) {
    const target = at(root, file.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.body);
    created.push(target);
  }

}

/** The lite sql helpers of platform/database (requireOwnedEntity, the bounds and the sql tag). */
const DATABASE_SQL_FILE = "be/src/modules/platform/database/database.sql.ts";

/** A skeleton file of platform/database a generator writes on first need: the app's copy, or else the template's. */
const deferredDatabaseFile = (skeleton: string, relative: string) => (text: string) =>
  text || render(fs.readFileSync(path.join(TEMPLATES_DIR, "be", skeleton, ...relative.split("/")), "utf8"), {});

function tableRegistrations({ root, repo, fe, edit }: { root: string, repo: TableRepo, fe: boolean, edit: Edit }): void {
  const errorFile = "be/src/modules/platform/database/errors/database.error.ts";
  if (repo.edition === "lite" && fs.existsSync(at(root, errorFile))) edit(errorFile, withSqlIdentifierError);
  // requireOwnedEntity lives in the sql helpers the lite starter leaves out; the first table writes them.
  if (repo.edition === "lite") edit(DATABASE_SQL_FILE, deferredDatabaseFile("skeleton-lite", "src/modules/platform/database/database.sql.ts"));
  // The table's entity extends UuidAbstractEntity, which no starter carries in either edition; the first table writes it.
  edit(`be/${ENTITY_BASE_FILE}`, deferredDatabaseFile("skeleton", ENTITY_BASE_FILE));
    const registrations = [
      "entity-base",
      ...(repo.edition === "lite" ? ["table"] : []),
      ...(fe ? ["api", "graphql"] : []),
    ];
    for (const generator of registrations) for (const relative of registrationFiles(generator)) edit(relative, (text) => text);
    for (const generator of registrations) registerLiteExports({ root, generator });
}

function wireTableFrontends({ root, feature, values, apps, edit }: { root: string, feature: string, values: TableValues, apps: readonly DeclaredApp[], edit: Edit }): void {
      registerLiteDomainService({ root, moduleSpecifier: `@modules/domain/${feature}`, service: `${values.Name}Service` });
      for (const app of apps) {
        for (const [relative, line] of feBarrels(app.name, values)) edit(relative, (text) => withExport(text, line));
        edit(`fe/apps/${app.name}/src/modules/config/index.ts`, withGraphqlUrl);
      }
}

/** The lite entity list: platform/database/entities.ts names the capability's `<c>Entities` in PRIMARY_ENTITIES (BE-PERSISTENCE-3). */
const PRIMARY_ENTITIES_FILE = "be/src/modules/platform/database/entities.ts";
const PRIMARY_ENTITIES = /(export const PRIMARY_ENTITIES[^=]*=\s*\[)([\s\S]*?)(\])/;

/** `text` of entities.ts with `<c>Entities` imported from the capability barrel and spread into PRIMARY_ENTITIES, once. */
function withPrimaryEntities(text: string, { feature, nameCamel }: { feature: string, nameCamel: string }): string {
  const list = `${nameCamel}Entities`;
  if (!PRIMARY_ENTITIES.test(text))
    throw new ScaffoldError("HFS_ADD_WIRE_MISSING", `add table names ${list} in PRIMARY_ENTITIES of ${PRIMARY_ENTITIES_FILE}, which declares no PRIMARY_ENTITIES array`);
  if (new RegExp(`\\.\\.\\.${list}\\b`).test(text)) return text;
  const imported = `import { ${list} } from "@modules/domain/${feature}"\n`;
  const withList = text.replace(PRIMARY_ENTITIES, (_all: string, head: string, items: string, tail: string) => {
    const entries = items.split(",").map((item) => item.trim()).filter(Boolean);
    return `${head}${[...entries, `...${list}`].join(", ")}${tail}`;
  });
  const lines = withList.split("\n");
  const lastImport = lines.reduce((at, line, index) => (line.startsWith("import ") ? index : at), -1);
  if (lastImport >= 0) lines.splice(lastImport + 1, 0, imported.trimEnd());
  return lastImport >= 0 ? lines.join("\n") : `${imported}${withList}`;
}

function wireTable({ root, repo, feature, values, ownerRelative, composition, fe, apps, edit }: { root: string, repo: TableRepo, feature: string, values: TableValues, ownerRelative: string, composition: readonly ComposePatch[], fe: boolean, apps: readonly DeclaredApp[], edit: Edit }): void {
    const kindsHome = kindsHomeOf(root, ownerRelative);
    if (repo.edition === "lite") edit(PRIMARY_ENTITIES_FILE, (text) => withPrimaryEntities(text, { feature, nameCamel: values.nameCamel }));
    for (const patch of composition) edit(patch.relative, () => patch.text);
    edit(kindsHome, (text) => wireKinds(text, kindsHome, { kinds: `${snakeOf(feature).toUpperCase()}_ERROR_KINDS`, specifier: `@modules/domain/${feature}` }));
  tableRegistrations({ root, repo, fe, edit });
  if (fe) wireTableFrontends({ root, feature, values, apps, edit });
}

function rollbackTable(root: string, touched: ReadonlyMap<string, Buffer | null>, created: readonly string[]): void {
    for (const [file, before] of touched) {
      if (before === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, before);
    }
    for (const file of [...created].reverse()) {
      if (fs.existsSync(file)) fs.rmSync(file);
      removeEmptyParents(file, root);
    }
    for (const [file, before] of touched) if (before === null) removeEmptyParents(file, root);
}

/** Everything the writing and wiring of a table needs. */
interface ApplyContext extends TableContext {
  readonly planned: readonly FileBody[];
  readonly composition: readonly ComposePatch[];
  readonly apps: readonly DeclaredApp[];
  readonly values: TableValues;
  readonly fe: boolean;
  readonly ownerRelative: string;
}

function applyTable(context: ApplyContext): void {
  const touched = new Map<string, Buffer | null>();
  const created: string[] = [];
  const edit = tableEditor(context.root, touched);
  try {
    writeTableFiles(context, created);
    wireTable({ ...context, edit });
  } catch (error) {
    rollbackTable(context.root, touched, created);
    throw error;
  }
}

/** Adds one table through typed domain/API groups and restores every touched byte on failure. */
export function addTable({ root, name, fe = false, now = Date.now }: { root: string, name: string, fe?: boolean, now?: () => number }): { created: string[] } {
  const context = tableContext({ root, name });
  const stamp = nextMigration({ ...context, now });
  const values = tableValues(context);
  const apps = productApps(context.repo, fe);
  const planned = tableFiles({ ...context, stamp, values, apps, fe });
  const owner = tableOwner({ ...context, planned });
  const composition = tableComposition({ ...context, ...owner, fe });
  applyTable({ ...context, ...owner, planned, composition, apps, values, fe });
  return {
    created: [...planned.map((file) => file.relative), ...composition.filter((patch) => patch.exists === false).map((patch) => patch.relative)],
  };
}
