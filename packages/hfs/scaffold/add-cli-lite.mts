import fs from "node:fs";
import path from "node:path";
import { resolveAppDeclaration } from "../runtime/scripts/hfs/slots.mjs";
import type { SlotManifest } from "../runtime/scripts/hfs/manifest-shape.mjs";
import { bundledPins } from "../runtime/scripts/hfs/canon-pins.mjs";
import { appScripts, appSource, bundledPresets, imageFiles, renderTargets, settleSource, TEMPLATES_DIR, writeTargets, type AppSourceFacts, type RenderedTarget, type ResolvedApp } from "../sync/index.mjs";
import { ScaffoldError } from "./service.mjs";
import { jsonText, packageJsonText } from "./app.mjs";
import { registerLiteExports } from "./lite-exports.mjs";
import { ensureLiteQueuesCli } from "./queues-cli-lite.mjs";
import { byCodeUnit } from "../report/order.mjs";

const read = (relative: string) =>
  fs
    .readFileSync(path.join(TEMPLATES_DIR, ...relative.split("/")), "utf8")
    .replace(/\r\n/g, "\n");


const managedScripts = (repo: ResolvedApp, source: AppSourceFacts): Record<string, string> => {
  const fragment = appScripts(repo, source).replace(/,\s*$/, "");
  return fragment === "" ? {} : JSON.parse(`{${fragment}}`);
};

const CLI_OPTIONS = `import type { DatabaseConnectionOptions } from "@modules/platform/database"

/** Everything the lite cli needs: the least-privilege PostgreSQL connection. */
export interface CliAppOptions {
    /** The connections the built-in migrate and seed groups operate on. */
    readonly connections: ReadonlyArray<DatabaseConnectionOptions>
}

/** Uses the parsed connection without adding entities or TypeORM migrations. */
export const createCliAppOptions = (primary: DatabaseConnectionOptions): CliAppOptions => ({
    connections: [primary],
})
`;

const MIGRATE_RUN = `import { CommandRunner, SubCommand } from "nest-commander"
import { MigrationRunnerService } from "@modules/platform/database"

@SubCommand({ name: "run", description: "Apply the pending db migrations" })
/** \`cli migrate run\`: delegates schema authority to the managed db:push script (starci app db migrate). */
export class MigrateRunCli extends CommandRunner {
    constructor(private readonly migrations: MigrationRunnerService) {
        super()
    }

    /** Runs the one managed migration wrapper and propagates its failure. */
    async run(): Promise<void> {
        await this.migrations.run()
    }
}
`;

const SEED_RUN = `import { CommandRunner, Option, SubCommand } from "nest-commander"
import { DEFAULT_SEED_ENV, SeedRunnerService } from "@modules/platform/database"

/** The options of \`cli seed run\`. */
export interface SeedRunOptions {
    /** The stack environment whose \`.starcistacks/<env>/seeds/sql\` runs after \`.starcistacks/seeds/sql\`. */
    readonly env?: string
}

@SubCommand({ name: "run", description: "Run the tracked SQL seeds through the application role" })
/** \`cli seed run [--env <name>]\`: executes the shared SQL seeds, then the environment's, through the shared least-privilege EntityManager. */
export class RunSeedsCli extends CommandRunner {
    constructor(private readonly seeds: SeedRunnerService) {
        super()
    }

    /** \`--env <name>\`: the stack environment whose seed runs after the shared one. */
    @Option({
        flags: "--env <name>",
        description: "The stack environment whose seed runs",
        defaultValue: DEFAULT_SEED_ENV,
    })
    parseEnv(value: string): string {
        return value
    }

    /** Executes the shared seed and the environment's own. */
    async run(_passed: Array<string>, options?: SeedRunOptions): Promise<void> {
        await this.seeds.run(options?.env)
    }
}
`;

const SEED_RUN_SPEC = `import { mock } from "@starci/jest-preset"
import { Test } from "@nestjs/testing"
import { SeedRunnerService } from "@modules/platform/database"
import { RunSeedsCli } from "./run.cli"

const build = async () => {
    const seeds = mock<SeedRunnerService>()
    const moduleRef = await Test.createTestingModule({
        providers: [RunSeedsCli, { provide: SeedRunnerService, useValue: seeds }],
    }).compile()
    return { command: moduleRef.get(RunSeedsCli), seeds }
}

describe("RunSeedsCli", () => {
    it("delegates the seed run of the named environment to the seed runner once", async () => {
        const { command, seeds } = await build()

        await expect(command.run([], { env: "production" })).resolves.toBeUndefined()

        expect(seeds.run).toHaveBeenCalledWith("production")
        expect(seeds.run).toHaveBeenCalledTimes(1)
    })

    it("delegates with no environment when none is named, and takes --env as given", async () => {
        const { command, seeds } = await build()

        await command.run([])

        expect(seeds.run).toHaveBeenCalledWith(undefined)
        expect(command.parseEnv("production")).toBe("production")
    })
})
`;

const SEED_MODULE = `import { Module } from "@nestjs/common"
import { SeedCli } from "./seed.cli"
import { ConfigurableModuleClass } from "./seed.module-definition"
import { RunSeedsCli } from "./subs/run.cli"

@Module({ providers: [SeedCli, RunSeedsCli] })
/** The lite seed group: the command and its runner of the tracked SQL seeds. */
export class SeedModule extends ConfigurableModuleClass {}
`;

function enableLiteCliDatabase(root: string): void {
  const relative = "be/src/modules/platform/database/database.module.ts";
  const file = path.join(root, ...relative.split("/"));
  if (!fs.existsSync(file)) {
    throw new ScaffoldError("HFS_ADD_CLI_DATABASE", `add cli needs the scaffolded ${relative}`);
  }
  let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (!text.includes('import { DB_PUSH_COMMAND, MigrationRunnerService } from "./migration-runner.service"')) {
    const anchor = 'import { ConfigurableModuleClass, OPTIONS_TYPE } from "./database.module-definition"';
    if (!text.includes(anchor)) throw new ScaffoldError("HFS_ADD_CLI_DATABASE", `${relative} has an unknown import shape`);
    text = text.replace(anchor, `${anchor}\nimport { DB_PUSH_COMMAND, MigrationRunnerService } from "./migration-runner.service"`);
  }
  if (!text.includes('import { SEED_ROOT_DEFAULT, SeedRunnerService } from "./seed-runner.service"')) {
    // The import of the entity-manager token, with or without the probe token beside it: it gains the runners' two tokens.
    const anchor = /^import \{([^}]*\bPRIMARY_ENTITY_MANAGER\b[^}]*)\} from "\.\/primary\.decorators"$/m.exec(text);
    if (!anchor) throw new ScaffoldError("HFS_ADD_CLI_DATABASE", `${relative} has an unknown import shape`);
    const names = [...new Set([...anchor[1]!.split(",").map((name) => name.trim()).filter(Boolean), "MIGRATION_COMMAND", "SEED_ROOT"])].sort(byCodeUnit);
    text = text.replace(anchor[0], `import { ${names.join(", ")} } from "./primary.decorators"\nimport { SEED_ROOT_DEFAULT, SeedRunnerService } from "./seed-runner.service"`);
  }
  // The runners and the two values they are injected with: the managed migration wrapper and the app root the seed levels are read under.
  const runners = (indent: string) => [
    `{ provide: MIGRATION_COMMAND, useValue: DB_PUSH_COMMAND },`,
    `{ provide: SEED_ROOT, useValue: SEED_ROOT_DEFAULT },`,
    "MigrationRunnerService,",
    "SeedRunnerService,",
  ].map((line) => `${indent}${line}`);
  for (const spread of ["...managers, ...probes", "...managers"]) {
    const providers = `            providers: [...(base.providers ?? []), ${spread}],`;
    if (!text.includes(providers)) continue;
    const members = ["...(base.providers ?? []),", ...spread.split(", ").map((member) => `${member},`)].map((line) => `                ${line}`);
    text = text.replace(providers, ["            providers: [", ...members, ...runners("                "), "            ],"].join("\n"));
    break;
  }
  const bareExports = "exports: [DATABASE_OPTIONS, ...managers.map((manager) => manager.provide)],";
  if (text.includes(bareExports)) {
    text = text.replace(
      bareExports,
      [
        "exports: [",
        "                DATABASE_OPTIONS,",
        "                ...managers.map((manager) => manager.provide),",
        "                MigrationRunnerService,",
        "                SeedRunnerService,",
        "            ],",
      ].join("\n"),
    );
  } else if (!text.includes("                MigrationRunnerService,")) {
    const anchor = "                ...managers.map((manager) => manager.provide),";
    if (!text.includes(anchor)) throw new ScaffoldError("HFS_ADD_CLI_DATABASE", `${relative} has an unknown exports shape`);
    text = text.replace(anchor, `${anchor}\n                MigrationRunnerService,\n                SeedRunnerService,`);
  }
  fs.writeFileSync(file, text);
  enableRunnerTokens(root);
  enableMigrationFailure(root);
  registerLiteExports({ root, generator: "cli" });
}

/** The injection tokens of the runners' process and seed root, declared beside the capability's other tokens (R85). */
const RUNNER_TOKENS = `
/** Token of the process a migration run starts; the database module provides the managed db:push wrapper. */
export const MIGRATION_COMMAND: unique symbol = Symbol("platform.database.migration-command")

/** Injects the process a migration run starts. Parameter type: MigrationCommand. */
export const InjectMigrationCommand = (): TypedParameterDecorator<MigrationCommand> =>
    injector<MigrationCommand>(MIGRATION_COMMAND)

/** Token of the folder seed paths are relative to; the database module provides the app root the run starts from. */
export const SEED_ROOT: unique symbol = Symbol("platform.database.seed-root")

/** Injects the folder seed paths are relative to. Parameter type: string. */
export const InjectSeedRoot = (): TypedParameterDecorator<string> => injector<string>(SEED_ROOT)
`;

function enableRunnerTokens(root: string): void {
  const relative = "be/src/modules/platform/database/primary.decorators.ts";
  const file = path.join(root, ...relative.split("/"));
  if (!fs.existsSync(file)) throw new ScaffoldError("HFS_ADD_CLI_DATABASE", `add cli needs the scaffolded ${relative}`);
  let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (text.includes("MIGRATION_COMMAND")) return;
  const anchor = 'import type { DatabaseProbeService } from "./database-probe.service"';
  if (!text.includes(anchor)) throw new ScaffoldError("HFS_ADD_CLI_DATABASE", `${relative} has an unknown import shape`);
  text = text.replace(anchor, `${anchor}\nimport type { MigrationCommand } from "./migration-runner.service"`);
  fs.writeFileSync(file, `${text.trimEnd()}\n${RUNNER_TOKENS}`);
}

/** DATABASE_MIGRATION_FAILED: the refusal of a migration run, added to the database error family the runner throws. */
function enableMigrationFailure(root: string): void {
  const relative = "be/src/modules/platform/database/errors/database.error.ts";
  const file = path.join(root, ...relative.split("/"));
  if (!fs.existsSync(file)) throw new ScaffoldError("HFS_ADD_CLI_DATABASE", `add cli needs the scaffolded ${relative}`);
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (text.includes('"DATABASE_MIGRATION_FAILED"')) return;
  const codes = /^export enum DatabaseErrorCode \{\n[\s\S]*?\n\}$/m.exec(text)?.[0];
  const kinds = /^export const DATABASE_ERROR_KINDS: Record<DatabaseErrorCode, ErrorKind> = \{\n[\s\S]*?\n\}$/m.exec(text)?.[0];
  if (!codes || !kinds) throw new ScaffoldError("HFS_ADD_CLI_DATABASE", `${relative} has an unknown error-family shape`);
  const code = [
    "    /** The managed migration wrapper (`npm run db:push`) did not finish with status 0 (`status` param, `none` without one), or could not start. */",
    '    MigrationFailed = "DATABASE_MIGRATION_FAILED",',
  ].join("\n");
  fs.writeFileSync(file, text
    .replace(codes, `${codes.slice(0, -2)}\n${code}\n}`)
    .replace(kinds, `${kinds.slice(0, -2)}\n    [DatabaseErrorCode.MigrationFailed]: "internal",\n}`));
}

/**
 * Creates the optional lite cli app, its typed CliEnv/readCliEnv boundary and its migrate/seed groups on first `add cli`.
 * Existing cli trees are never repaired or overwritten: drift remains a check finding.
 */
/** An app entry of the be side of hfs.json. */
interface BeAppEntry {
  readonly name: string;
  readonly kind: string;
}

export function ensureLiteCli({ root, manifest, repo }: { root: string, manifest: SlotManifest, repo: { edition?: string | undefined } }): string[] {
  if (repo.edition !== "lite") return [];
  const declarationFile = path.join(root, "hfs.json");
  const declaration = JSON.parse(fs.readFileSync(declarationFile, "utf8"));
  const cliApps = declaration.sides.be.apps.filter((app: BeAppEntry) => app.kind === "cli");
  if (cliApps.length > 1 || cliApps.some((app: BeAppEntry) => app.name !== "cli")) {
    throw new ScaffoldError(
      "HFS_ADD_CLI_DRIFT",
      `hfs.json declares the cli app${cliApps.length === 1 ? "" : "s"} named ${cliApps.map((app: BeAppEntry) => app.name).join(", ")}; lite has one cli app named cli`,
    );
  }
  const declared = cliApps.length === 1;
  const cliRoot = path.join(root, "be", "apps", "cli");
  if (declared) {
    if (!fs.existsSync(cliRoot))
      throw new ScaffoldError(
        "HFS_ADD_CLI_DRIFT",
        "hfs.json declares the cli app but be/apps/cli is missing; restore the declared tree before adding a group",
      );
    return [];
  }
  if (
    fs.existsSync(cliRoot) ||
    fs.existsSync(path.join(root, "be", "src", "features", "cli"))
  ) {
    throw new ScaffoldError(
      "HFS_ADD_EXISTS",
      "a cli tree exists but hfs.json does not declare it; starci app add never adopts an unowned tree",
    );
  }

  const files: Array<[string, string]> = [
    ["be/apps/cli/src/main.ts", read("be/skeleton/apps/cli/src/main.ts")],
    [
      "be/apps/cli/src/app.module.ts",
      read("be/skeleton/apps/cli/src/app.module.ts"),
    ],
    ["be/apps/cli/src/compose/platform.ts", read("be/skeleton-lite/apps/cli/src/compose/platform.ts")],
    ["be/apps/cli/src/compose/cli.ts", read("be/skeleton/apps/cli/src/compose/cli.ts")],
    ["be/src/tests/fixtures/builders/cli.builder.ts", read("be/skeleton-lite/src/tests/fixtures/builders/cli.builder.ts")],
    ["be/apps/cli/src/cli.env.ts", read("be/skeleton-lite/apps/cli/src/cli.env.ts")],
    ["be/apps/cli/src/cli.options.ts", CLI_OPTIONS],
    [
      "be/src/features/cli/index.ts",
      read("be/skeleton/src/features/cli/index.ts"),
    ],
    [
      "be/src/features/cli/cli.module.ts",
      read("be/skeleton/src/features/cli/cli.module.ts"),
    ],
    [
      "be/src/features/cli/cli.module-definition.ts",
      read("be/skeleton/src/features/cli/cli.module-definition.ts"),
    ],
    [
      "be/src/features/cli/cli.options.ts",
      read("be/skeleton/src/features/cli/cli.options.ts"),
    ],
    [
      "be/src/features/cli/migrate/migrate.module-definition.ts",
      read("be/skeleton/src/features/cli/migrate/migrate.module-definition.ts"),
    ],
    [
      "be/src/features/cli/migrate/migrate.options.ts",
      read("be/skeleton/src/features/cli/migrate/migrate.options.ts"),
    ],
    [
      "be/src/features/cli/seed/seed.module-definition.ts",
      read("be/skeleton/src/features/cli/seed/seed.module-definition.ts"),
    ],
    [
      "be/src/features/cli/seed/seed.options.ts",
      read("be/skeleton/src/features/cli/seed/seed.options.ts"),
    ],
    [
      "be/src/features/cli/migrate/migrate.cli.ts",
      read("be/skeleton/src/features/cli/migrate/migrate.cli.ts"),
    ],
    [
      "be/src/features/cli/migrate/migrate.module.ts",
      read("be/skeleton/src/features/cli/migrate/migrate.module.ts"),
    ],
    [
      "be/src/modules/platform/database/migration-runner.service.ts",
      read("be/skeleton-lite/src/modules/platform/database/migration-runner.service.ts"),
    ],
    // BE-TEST-13: each runner service owes its unit spec beside it.
    [
      "be/src/modules/platform/database/migration-runner.service.spec.ts",
      read("be/skeleton-lite/src/modules/platform/database/migration-runner.service.spec.ts"),
    ],
    ["be/src/features/cli/migrate/subs/run.cli.ts", MIGRATE_RUN],
    // R212: each cli command of a lite back end owes its unit spec, as in full (ruleParams.be.unitRoles).
    [
      "be/src/features/cli/migrate/migrate.cli.spec.ts",
      read("be/skeleton/src/features/cli/migrate/migrate.cli.spec.ts"),
    ],
    [
      "be/src/features/cli/migrate/subs/run.cli.spec.ts",
      read("be/skeleton/src/features/cli/migrate/subs/run.cli.spec.ts"),
    ],
    [
      "be/src/features/cli/seed/seed.cli.ts",
      read("be/skeleton/src/features/cli/seed/seed.cli.ts"),
    ],
    [
      "be/src/features/cli/seed/seed.module.ts",
      SEED_MODULE,
    ],
    [
      "be/src/modules/platform/database/seed-runner.service.ts",
      read("be/skeleton-lite/src/modules/platform/database/seed-runner.service.ts"),
    ],
    [
      "be/src/modules/platform/database/seed-runner.service.spec.ts",
      read("be/skeleton-lite/src/modules/platform/database/seed-runner.service.spec.ts"),
    ],
    ["be/src/features/cli/seed/subs/run.cli.ts", SEED_RUN],
    [
      "be/src/features/cli/seed/seed.cli.spec.ts",
      read("be/skeleton/src/features/cli/seed/seed.cli.spec.ts"),
    ],
    ["be/src/features/cli/seed/subs/run.cli.spec.ts", SEED_RUN_SPEC],
  ];
  const managedBefore = renderManaged(root, structuredClone(declaration), manifest);
  declaration.sides.be.apps.push({ name: "cli", kind: "cli" });
  declaration.sides.be.kinds = [
    ...new Set([...(declaration.sides.be.kinds ?? []), "cli"]),
  ].sort(byCodeUnit);
  const resolved = resolveAppDeclaration(manifest, declaration);
  const image = imageFiles(resolved).find(
    (file: { path: string }) => file.path === "be/apps/cli/Dockerfile",
  );
  if (!image)
    throw new ScaffoldError(
      "HFS_ADD_TEMPLATE_MISSING",
      "the cli Dockerfile template did not render",
    );
  files.push([image.path, image.content]);

  const nestFile = path.join(root, "be", "nest-cli.json");
  const packageFile = path.join(root, "package.json");
  if (!fs.existsSync(nestFile))
    throw new ScaffoldError(
      "HFS_ADD_CLI_NEST_CONFIG",
      "add cli needs be/nest-cli.json",
    );
  const nest = JSON.parse(fs.readFileSync(nestFile, "utf8"));
  nest.projects = {
    ...nest.projects,
    cli: {
      type: "application",
      root: "apps/cli",
      entryFile: "main",
      sourceRoot: "apps/cli/src",
    },
  };
  if (!fs.existsSync(packageFile))
    throw new ScaffoldError("HFS_ADD_NOT_AN_APP", "add cli needs the app root package.json");
  const packageManifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  const pin = bundledPins()["nest-commander"]?.version;
  if (typeof pin !== "string" || pin === "")
    throw new ScaffoldError("HFS_ADD_CANON_PIN_MISSING", "add cli needs the nest-commander canon pin");
  packageManifest.dependencies = { ...packageManifest.dependencies, "nest-commander": pin };
  packageManifest.scripts = {
    ...packageManifest.scripts,
    ...managedScripts(resolved, appSource(root)),
  };
  for (const [relative, body] of files) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  enableLiteCliDatabase(root);
  fs.writeFileSync(nestFile, jsonText(nest));
  fs.writeFileSync(declarationFile, jsonText(declaration));
  fs.writeFileSync(packageFile, packageJsonText(packageManifest));
  const rerendered = writeTargets(root, managedChanges(managedBefore, renderManaged(root, declaration, manifest)));
  return [...files.map(([relative]) => relative), ...rerendered, ...ensureLiteQueuesCli(root)];
}

/** The managed targets of the app at `root` under a declaration, over the source on disk now. */
const renderManaged = (root: string, declaration: unknown, manifest: SlotManifest): RenderedTarget[] => {
  const source = appSource(root);
  return renderTargets(declaration, bundledPresets(), { manifest, source: settleSource(source, renderTargets(declaration, bundledPresets(), { manifest, source })) });
};

/** The targets whose render the cli app changed (the images workflow gains its image, the CI shards its files): the add leaves them in sync. */
const managedChanges = (before: readonly RenderedTarget[], after: readonly RenderedTarget[]): RenderedTarget[] =>
  after.filter((target) => before.find((each) => each.path === target.path)?.hash !== target.hash);
