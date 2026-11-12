/**
 * The rules of the command lines of a back end (catalog R148 `BE_CLI_BOOTSTRAP`, R149 `BE_CLI_COMMAND_SHAPE`, R150
 * `BE_CLI_OWNER`, R398 `BE_CLI_CLIENT_BOUNDARY`). A cli app is built on nest-commander and its commands live in its own feature
 * root: the ops cli `be/apps/cli` (slot `be.app.cli`: every one-off action, migrate, seed, sync, backup, any operator command)
 * with `src/features/cli/` (slot `be.cli`), and a client cli `be/apps/<app>` (slot `be.app.client-cli`: a command line a user
 * installs from npm) with `src/features/client-cli/<app>/` (slot `be.client-cli`):
 *
 *   - `cli-bootstrap`: a cli app boots with `CommandFactory.run(...)` of nest-commander in its `main.ts`; it never creates an HTTP
 *     application or a microservice (`NestFactory.create*` of `@nestjs/core`, `.listen()` on what it built, an HTTP platform adapter
 *     or `@nestjs/microservices`);
 *   - `cli-command-shape`: a nest-commander command class (`@Command` or `@SubCommand`, by the import that binds the decorator) is
 *     declared only in a cli feature root: a group `@Command` in `<group>/<group>.cli.ts`, a `@SubCommand` in
 *     `<group>/subs/<name>.cli.ts`, one class per file, and a sub-command extends `CommandRunner`. Its unit spec beside it
 *     (`<name>.cli.spec.ts`) is required by `unit-test-colocated`;
 *   - `cli-owner`: `nest-commander` is imported only by the cli apps and the cli feature roots; no back-end source parses the process
 *     arguments itself (`process.argv`) or imports another argument parser (commander, yargs, minimist): an action door anywhere
 *     else is refused;
 *   - `cli-client-boundary`: a client cli runs on a user's machine, so its app and its feature root import no domain, events,
 *     queues or projections module, nothing of the database capability or of a persistence folder, and no database library.
 *
 * Where a file lives is asked of the slot view; what a name IS comes from the import that binds it. No path pattern is spelled here.
 */
import { posix } from "node:path"
import { hfsOf } from "./lib/hfs.ts"
import { decoratorCallee, importOf, isImportedFrom, moduleReferences } from "./lib/import-source.ts"
import { normalizePath } from "./lib/path.ts"
import type { Context, Recommended, RuleModule, Rules } from "./lib/rule.ts"
import { resolveAlias } from "./lib/specifier.ts"
import type { HfsView } from "./lib/hfs.ts"
import type { TSESLint, TSESTree } from "@typescript-eslint/utils"

/** A class node: a declaration or an expression. */
type ClassNode = TSESTree.ClassDeclaration | TSESTree.ClassExpression

/** The slots of the client cli: its app and its feature root. */
const CLIENT_APP_SLOT = "be.app.client-cli"
const CLIENT_FEATURE_SLOT = "be.client-cli"
/** The slots of a cli app (the ops cli, a client cli) and of a cli feature root (of the ops cli, of a client cli). */
const CLI_APP_SLOTS = new Set(["be.app.cli", CLIENT_APP_SLOT])
const CLI_FEATURE_SLOTS = new Set(["be.cli", CLIENT_FEATURE_SLOT])
const COMMANDER = "nest-commander"
/** The argument parsers no back-end source imports: nest-commander (in the cli app and feature only) parses the arguments. */
const FOREIGN_PARSERS = new Set(["commander", "yargs", "yargs/yargs", "yargs/helpers", "minimist"])
/** The entry file of an app (the slot's first requirement): where the cli app boots. */
const ENTRY = "main.ts"

const relativeIn = (hfs: HfsView, file: string) => hfs.allows(file)?.relative ?? null
const isCliApp = (hfs: HfsView, file: string) => CLI_APP_SLOTS.has(hfs.slotOf(file) ?? "")
const isCliFeature = (hfs: HfsView, file: string) => CLI_FEATURE_SLOTS.has(hfs.slotOf(file) ?? "")
const isClientCli = (hfs: HfsView, file: string) => hfs.slotOf(file) === CLIENT_APP_SLOT || hfs.slotOf(file) === CLIENT_FEATURE_SLOT

/** A cli app boots with CommandFactory.run and never serves HTTP or a microservice. */
export const cliBootstrap: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A cli app boots with `CommandFactory.run` of nest-commander and never creates an HTTP application or a microservice." },
        schema: [],
        messages: {
            missing: "The cli app's `main.ts` never calls `CommandFactory.run(AppModule, ...)` of nest-commander. The cli app is the command line of the back end: boot it with CommandFactory.run, which parses the arguments and runs the command.",
            server: "`{{name}}` makes the cli app a server. The cli app runs one command and exits: boot it with `CommandFactory.run` of nest-commander; a server is an api app.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const filename = context.filename
        if (!isCliApp(hfs, filename)) return {}
        const entry = relativeIn(hfs, filename) === ENTRY
        let boots = false
        return {
            ...moduleReferences(({ source, value }) => {
                if (value === "@nestjs/microservices" || value.startsWith("@nestjs/platform-")) context.report({ node: source, messageId: "server", data: { name: value } })
            }),
            CallExpression(node) {
                const callee = node.callee
                if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return
                const method = callee.property.name
                if (method === "run" && isImportedFrom(context, callee.object, COMMANDER, "CommandFactory")) boots = true
                if (isImportedFrom(context, callee.object, "@nestjs/core", "NestFactory")) context.report({ node, messageId: "server", data: { name: `NestFactory.${method}` } })
                else if (method === "listen" || method === "connectMicroservice" || method === "startAllMicroservices") context.report({ node, messageId: "server", data: { name: `.${method}()` } })
            },
            "Program:exit"(program) {
                if (entry && !boots) context.report({ node: program, messageId: "missing" })
            },
        }
    },
}

/** The nest-commander decorator a class carries (Command or SubCommand), by the import that binds it. */
const commanderDecorator = (context: Context, klass: ClassNode) => {
    for (const decorator of klass.decorators ?? []) {
        const callee = decoratorCallee(decorator)
        if (callee?.type !== "Identifier") continue
        const bound = importOf(context, callee)
        if (bound?.source === COMMANDER && (bound.imported === "Command" || bound.imported === "SubCommand")) return { decorator, kind: bound.imported }
    }
    return null
}

/** Where a command of each kind is declared in a cli feature root: `<group>/<group>.cli.ts` or `<group>/subs/<name>.cli.ts`. */
const placeOf = (relative: string | null) => {
    const parts = String(relative ?? "").split("/")
    if (parts.length === 2 && parts[1] === `${parts[0]}.cli.ts`) return "Command"
    const leaf = parts[2]
    if (parts.length === 3 && parts[1] === "subs" && leaf !== undefined && leaf.endsWith(".cli.ts") && !leaf.endsWith(".spec.ts")) return "SubCommand"
    return null
}

/** A nest-commander command is declared only where a cli feature root keeps it, one per file, a sub-command a CommandRunner. */
export const cliCommandShape: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A nest-commander command is a group `@Command` in `<group>/<group>.cli.ts` or a `@SubCommand` extending `CommandRunner` in `<group>/subs/<name>.cli.ts` of a cli feature root (`src/features/cli/`, `src/features/client-cli/<app>/`), one per file." },
        schema: [],
        messages: {
            outside: "`@{{kind}}` declares a command outside a cli feature root (this file is in slot `{{slot}}`). A one-off action is a command of `src/features/cli/`, compiled only into apps/cli; a command a user runs is one of `src/features/client-cli/<app>/`, compiled only into that client cli: a group in `<group>/<group>.cli.ts`, a sub-command in `<group>/subs/<name>.cli.ts`.",
            misplaced: "`@{{kind}}` sits in `{{relative}}`. A group `@Command` lives in `<group>/<group>.cli.ts` and a `@SubCommand` in `<group>/subs/<name>.cli.ts` of its cli feature root.",
            second: "This file declares a second command. One command per file: move it to its own `<name>.cli.ts`.",
            runner: "`@SubCommand` class `{{name}}` does not extend `CommandRunner` of nest-commander. A sub-command is a CommandRunner whose `run(...)` performs the action.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const filename = context.filename
        const slot = hfs.slotOf(filename)
        const place = isCliFeature(hfs, filename) ? placeOf(relativeIn(hfs, filename)) : null
        let commands = 0
        const check = (klass: ClassNode) => {
            const found = commanderDecorator(context, klass)
            if (!found) return
            commands += 1
            if (!isCliFeature(hfs, filename)) return context.report({ node: found.decorator, messageId: "outside", data: { kind: found.kind, slot: slot ?? "none" } })
            if (place !== found.kind) return context.report({ node: found.decorator, messageId: "misplaced", data: { kind: found.kind, relative: relativeIn(hfs, filename) ?? filename } })
            if (commands > 1) return context.report({ node: found.decorator, messageId: "second" })
            if (found.kind === "SubCommand" && !(klass.superClass && isImportedFrom(context, klass.superClass, COMMANDER, "CommandRunner"))) context.report({ node: klass.id ?? klass, messageId: "runner", data: { name: klass.id?.name ?? "anonymous" } })
        }
        return { ClassDeclaration: check, ClassExpression: check }
    },
}

/** Whether a member expression is `process.argv` of the Node global (or `globalThis.process.argv`). */
const isProcessArgv = (context: Context, node: TSESTree.MemberExpression) => {
    if (node.computed || node.property.type !== "Identifier" || node.property.name !== "argv") return false
    const object = node.object
    const isProcess = (expression: TSESTree.Expression) => {
        if (expression.type !== "Identifier" || expression.name !== "process") return false
        for (let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(expression); scope; scope = scope.upper) {
            const variable = scope.set.get("process")
            if (variable) return variable.defs.length === 0
        }
        return true
    }
    if (isProcess(object)) return true
    return object.type === "MemberExpression" && !object.computed && object.object.type === "Identifier" && object.object.name === "globalThis" && object.property.type === "Identifier" && object.property.name === "process"
}

/** nest-commander belongs to the cli apps and the cli feature roots; nothing else parses arguments or opens an action door. */
export const cliOwner: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "nest-commander is imported only by the cli apps and the cli feature roots; no back-end source reads `process.argv` or imports another argument parser." },
        schema: [],
        messages: {
            commander: "`nest-commander` is imported outside a cli app and a cli feature root (this file is in slot `{{slot}}`). A one-off action is a command of `src/features/cli/` run by apps/cli, and a command a user runs is one of a client cli's `src/features/client-cli/<app>/`; no other app or source opens an action door.",
            parser: "`{{name}}` parses command-line arguments. A command line of the back end is a cli app on nest-commander: write the action as a command `<group>/subs/<name>.cli.ts` of its feature root.",
            argv: "`process.argv` is read here. No back-end process parses its own arguments: an action is a command of a cli feature root that its cli app runs through nest-commander.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const filename = context.filename
        const slot = hfs.slotOf(filename)
        const owner = isCliApp(hfs, filename) || isCliFeature(hfs, filename)
        return {
            ...moduleReferences(({ source, value }) => {
                if (value === COMMANDER || value.startsWith(`${COMMANDER}/`)) {
                    if (!owner) context.report({ node: source, messageId: "commander", data: { slot: slot ?? "none" } })
                } else if (FOREIGN_PARSERS.has(value)) context.report({ node: source, messageId: "parser", data: { name: value } })
            }),
            MemberExpression(node) {
                if (isProcessArgv(context, node)) context.report({ node, messageId: "argv" })
            },
        }
    },
}

/** The tiers a client cli never imports: the business of the server and its messaging. */
const SERVER_TIERS = new Set(["domain", "events", "queues", "projections"])
/** The libraries that talk to the database: a client cli holds no connection. */
const DATABASE_LIBRARIES = ["typeorm", "@nestjs/typeorm", "pg"]
const DATABASE_CAPABILITY = "database"
const PERSISTENCE_SLOT = "be.persistence"

/** The file an import of a relative or aliased specifier names, as its two candidate paths (a folder entry, a file); none for a package. */
const targetsOf = (context: Context, specifier: string): string[] => {
    const base = specifier.startsWith(".") ? posix.join(posix.dirname(normalizePath(context.filename)), specifier) : resolveAlias(context, specifier)?.target
    return base === undefined ? [] : [`${base}/index.ts`, `${base}.ts`]
}

/** Why a client cli may not import a file of the back end, or null when it may. */
const serverSideOf = (hfs: HfsView, file: string): string | null => {
    const tier = hfs.tierOf(file)
    if (tier !== null && SERVER_TIERS.has(tier)) return `a ${tier} module`
    const found = hfs.classify(file)
    if (found.slot === PERSISTENCE_SLOT) return "a persistence folder"
    if (found.bindings?.["capability"] === DATABASE_CAPABILITY && tier === "platform") return "the database capability"
    return null
}

/** A client cli imports nothing of the server: no domain or messaging module, no database capability or persistence, no database library. */
export const cliClientBoundary: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "A client cli (its app and its feature root) imports no domain, events, queues or projections module, nothing of the database capability or of a persistence folder, and no database library." },
        schema: [],
        messages: {
            server: "`{{name}}` is {{what}}. A client cli runs on a user's machine and holds nothing of the server: it calls the server through an integration client (`modules/integrations/<provider>`) and composes platform capabilities only.",
            library: "`{{name}}` is a database library. A client cli holds no database connection: what it needs from the data it asks the server for, through an integration client.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        if (!isClientCli(hfs, context.filename)) return {}
        return moduleReferences(({ source, value }) => {
            if (DATABASE_LIBRARIES.some((name) => value === name || value.startsWith(`${name}/`))) return context.report({ node: source, messageId: "library", data: { name: value } })
            for (const target of targetsOf(context, value)) {
                const what = serverSideOf(hfs, target)
                if (what === null) continue
                return context.report({ node: source, messageId: "server", data: { name: value, what } })
            }
        })
    },
}

/** The rules this law contributes to the plugin. */
export const rules = {
    "cli-bootstrap": cliBootstrap,
    "cli-client-boundary": cliClientBoundary,
    "cli-command-shape": cliCommandShape,
    "cli-owner": cliOwner,
} satisfies Rules

/** Every rule is an error from the start: HFS keeps no baseline. */
export const recommended: Recommended = {
    "starci-be/cli-bootstrap": "error",
    "starci-be/cli-client-boundary": "error",
    "starci-be/cli-command-shape": "error",
    "starci-be/cli-owner": "error",
}
