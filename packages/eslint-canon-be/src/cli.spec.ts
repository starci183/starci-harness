import test from "node:test"
import { at, typedTester } from "../fixtures/typed/tester.ts"
import { cliBootstrap, cliClientBoundary, cliCommandShape, cliOwner } from "./cli.ts"

const declaration = {
    apps: [{ name: "api", kind: "api" }, { name: "cli", kind: "cli" }],
    connections: [{ name: "primary", envPrefix: "PRIMARY_DB", owner: "api", isolation: "database" }],
}
const tester = typedTester({ declaration })
const CLI_MAIN = at("apps/cli/src/main.ts")
const CLI_MODULE = at("apps/cli/src/app.module.ts")
const API_MAIN = at("apps/api/src/main.ts")
const GROUP = at("src/features/cli/migrate/migrate.cli.ts")
const SUB = at("src/features/cli/migrate/subs/run.cli.ts")
const SUB_SPEC = at("src/features/cli/migrate/subs/run.cli.spec.ts")
const HANDLER = at("src/features/api/orders/application/place-order.handler.ts")
const DOMAIN = at("src/modules/domain/order/order.service.ts")

const BOOT = 'import { CommandFactory } from "nest-commander"\nimport { AppModule } from "./app.module"\nvoid CommandFactory.run(AppModule)\n'

test("BE_CLI_BOOTSTRAP: the cli app boots with CommandFactory.run and never serves", () => {
    tester.run("cli-bootstrap", cliBootstrap, {
        valid: [
            { filename: CLI_MAIN, code: BOOT },
            // a renamed or namespace import of nest-commander is the same CommandFactory
            { filename: CLI_MAIN, code: 'import * as commander from "nest-commander"\nimport { AppModule } from "./app.module"\nvoid commander.CommandFactory.run(AppModule)\n' },
            // the root module of the cli app is no entry: it composes, it does not boot
            { filename: CLI_MODULE, code: 'export class AppModule {}\n' },
            // an api app is not judged by this rule
            { filename: API_MAIN, code: 'import { NestFactory } from "@nestjs/core"\nconst app = await NestFactory.create(class {})\nawait app.listen(3000)\n' },
        ],
        invalid: [
            { filename: CLI_MAIN, code: 'import { AppModule } from "./app.module"\nexport const app = AppModule\n', errors: [{ messageId: "missing" }] },
            // a local CommandFactory is not nest-commander's
            { filename: CLI_MAIN, code: 'const CommandFactory = { run: (m: unknown) => m }\nvoid CommandFactory.run(1)\n', errors: [{ messageId: "missing" }] },
            { filename: CLI_MAIN, code: `${BOOT}import { NestFactory } from "@nestjs/core"\nconst app = await NestFactory.create(class {})\nawait app.listen(3000)\n`, errors: [{ messageId: "server" }, { messageId: "server" }] },
            { filename: CLI_MODULE, code: 'import { Transport } from "@nestjs/microservices"\nexport const t = Transport\n', errors: [{ messageId: "server" }] },
            { filename: CLI_MODULE, code: 'import { ExpressAdapter } from "@nestjs/platform-express"\nexport const a = ExpressAdapter\n', errors: [{ messageId: "server" }] },
        ],
    })
})

const SUB_CODE = 'import { CommandRunner, SubCommand } from "nest-commander"\n@SubCommand({ name: "run" })\nexport class RunCli extends CommandRunner { async run(): Promise<void> {} }\n'
const GROUP_CODE = 'import { Command, CommandRunner } from "nest-commander"\n@Command({ name: "migrate", subCommands: [] })\nexport class MigrateCli extends CommandRunner { async run(): Promise<void> {} }\n'

test("BE_CLI_COMMAND_SHAPE: a group in <group>/<group>.cli.ts, a CommandRunner sub-command in <group>/subs/<name>.cli.ts, one per file", () => {
    tester.run("cli-command-shape", cliCommandShape, {
        valid: [
            { filename: SUB, code: SUB_CODE },
            { filename: GROUP, code: GROUP_CODE },
            // a CQRS command class is no nest-commander command, wherever it is (a local Command decorator is not nest-commander's)
            { filename: HANDLER, code: 'import { CommandHandler } from "@nestjs/cqrs"\n@CommandHandler(class {})\nexport class PlaceOrderHandler {}\n' },
            { filename: DOMAIN, code: 'const Command = () => (target: unknown) => target\n@Command()\nexport class Local {}\n' },
            // the spec beside a sub-command declares no command
            { filename: SUB_SPEC, code: 'import { describe } from "@jest/globals"\ndescribe("run", () => undefined)\n' },
        ],
        invalid: [
            { filename: HANDLER, code: SUB_CODE, errors: [{ messageId: "outside" }] },
            { filename: CLI_MAIN, code: GROUP_CODE, errors: [{ messageId: "outside" }] },
            // a sub-command in the group file and a group in a subs file are misplaced
            { filename: GROUP, code: SUB_CODE, errors: [{ messageId: "misplaced" }] },
            { filename: SUB, code: GROUP_CODE, errors: [{ messageId: "misplaced" }] },
            { filename: at("src/features/cli/migrate/run.cli.ts"), code: SUB_CODE, errors: [{ messageId: "misplaced" }] },
            { filename: SUB, code: `${SUB_CODE}@SubCommand({ name: "again" })\nexport class AgainCli extends CommandRunner { async run(): Promise<void> {} }\n`, errors: [{ messageId: "second" }] },
            { filename: SUB, code: 'import { SubCommand } from "nest-commander"\n@SubCommand({ name: "run" })\nexport class RunCli { async run(): Promise<void> {} }\n', errors: [{ messageId: "runner" }] },
        ],
    })
})

test("BE_CLI_OWNER: nest-commander only in the cli app and the cli feature root; no process.argv and no other parser anywhere", () => {
    tester.run("cli-owner", cliOwner, {
        valid: [
            { filename: CLI_MAIN, code: BOOT },
            { filename: SUB, code: SUB_CODE },
            // a local binding named process is not the Node global
            { filename: DOMAIN, code: 'export const read = (process: { argv: string[] }) => process.argv\n' },
            { filename: DOMAIN, code: 'export const env = process.env.NODE_ENV\n' },
        ],
        invalid: [
            { filename: API_MAIN, code: BOOT, errors: [{ messageId: "commander" }] },
            { filename: HANDLER, code: 'import { CommandRunner } from "nest-commander"\nexport const r = CommandRunner\n', errors: [{ messageId: "commander" }] },
            { filename: API_MAIN, code: 'export const migrate = process.argv[2] === "migrate"\n', errors: [{ messageId: "argv" }] },
            { filename: CLI_MAIN, code: `${BOOT}export const raw = globalThis.process.argv\n`, errors: [{ messageId: "argv" }] },
            { filename: DOMAIN, code: 'import yargs from "yargs"\nexport const y = yargs\n', errors: [{ messageId: "parser" }] },
            { filename: SUB, code: 'import minimist from "minimist"\nexport const m = minimist\n', errors: [{ messageId: "parser" }] },
            { filename: DOMAIN, code: 'import { Command } from "commander"\nexport const c = Command\n', errors: [{ messageId: "parser" }] },
        ],
    })
})

const CLIENT_DECLARATION = {
    apps: [{ name: "api", kind: "api" }, { name: "cli", kind: "cli" }, { name: "relay-cli", kind: "client-cli", package: "@acme/relay", bin: "relay" }],
    kinds: ["api", "cli", "client-cli"],
    connections: [{ name: "primary", envPrefix: "PRIMARY_DB", owner: "api", isolation: "database" }],
}
const clientTester = typedTester({ declaration: CLIENT_DECLARATION })
const CLIENT_MAIN = at("apps/relay-cli/src/main.ts")
const CLIENT_COMPOSE = at("apps/relay-cli/src/compose/cli.ts")
const CLIENT_GROUP = at("src/features/client-cli/relay-cli/run/run.cli.ts")
const CLIENT_SUB = at("src/features/client-cli/relay-cli/run/subs/task.cli.ts")

test("a client cli is a cli app: it boots with CommandFactory.run, owns nest-commander and keeps its commands in its own feature root", () => {
    clientTester.run("cli-bootstrap", cliBootstrap, {
        valid: [{ filename: CLIENT_MAIN, code: BOOT }],
        invalid: [
            { filename: CLIENT_MAIN, code: 'import { AppModule } from "./app.module"\nexport const app = AppModule\n', errors: [{ messageId: "missing" }] },
            { filename: CLIENT_COMPOSE, code: 'import { ExpressAdapter } from "@nestjs/platform-express"\nexport const a = ExpressAdapter\n', errors: [{ messageId: "server" }] },
        ],
    })
    clientTester.run("cli-owner", cliOwner, {
        valid: [{ filename: CLIENT_MAIN, code: BOOT }, { filename: CLIENT_SUB, code: SUB_CODE }],
        invalid: [{ filename: API_MAIN, code: BOOT, errors: [{ messageId: "commander" }] }],
    })
    clientTester.run("cli-command-shape", cliCommandShape, {
        valid: [{ filename: CLIENT_GROUP, code: GROUP_CODE }, { filename: CLIENT_SUB, code: SUB_CODE }, { filename: SUB, code: SUB_CODE }],
        invalid: [
            { filename: CLIENT_GROUP, code: SUB_CODE, errors: [{ messageId: "misplaced" }] },
            { filename: CLIENT_MAIN, code: GROUP_CODE, errors: [{ messageId: "outside" }] },
        ],
    })
})

test("BE_CLI_CLIENT_BOUNDARY: a client cli imports no server module, no database capability or persistence and no database library", () => {
    clientTester.run("cli-client-boundary", cliClientBoundary, {
        valid: [
            // platform capabilities and an integration client are what a client cli composes
            { filename: CLIENT_COMPOSE, code: 'import { ClockModule } from "@modules/platform/clock"\nimport { RelayClientModule } from "@modules/integrations/relay-client"\nexport const modules = [ClockModule, RelayClientModule]\n' },
            { filename: CLIENT_SUB, code: 'import { RelayClient } from "../../../../../modules/integrations/relay-client"\nexport const client = RelayClient\n' },
            // the ops cli and an api app are not judged by this rule
            { filename: CLI_MODULE, code: 'import { DataSource } from "typeorm"\nimport { OrderService } from "@modules/domain/order"\nexport const parts = [DataSource, OrderService]\n' },
            { filename: SUB, code: 'import { MigrationRunnerService } from "@modules/platform/database"\nexport const runner = MigrationRunnerService\n' },
        ],
        invalid: [
            { filename: CLIENT_COMPOSE, code: 'import { OrderModule } from "@modules/domain/order"\nexport const modules = [OrderModule]\n', errors: [{ messageId: "server" }] },
            { filename: CLIENT_SUB, code: 'import { OrderService } from "../../../../../modules/domain/order/order.service"\nexport const service = OrderService\n', errors: [{ messageId: "server" }] },
            { filename: CLIENT_COMPOSE, code: 'import { DatabaseModule } from "@modules/platform/database"\nexport const modules = [DatabaseModule]\n', errors: [{ messageId: "server" }] },
            { filename: CLIENT_SUB, code: 'import { DataSource } from "typeorm"\nexport const source = DataSource\n', errors: [{ messageId: "library" }] },
            { filename: CLIENT_COMPOSE, code: 'import { TypeOrmModule } from "@nestjs/typeorm"\nimport type { Pool } from "pg"\nexport const parts: [unknown, Pool | null] = [TypeOrmModule, null]\n', errors: [{ messageId: "library" }, { messageId: "library" }] },
        ],
    })
})
