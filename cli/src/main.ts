#!/usr/bin/env node
import { resolve } from "node:path"
import { Command, CommanderError } from "commander"
import { verbsFor } from "./registry.js"
import { asRefusal, EXIT_USAGE, UsageError } from "./shared/errors.js"
import { printRefusal, printResult } from "./shared/output.js"
import type { OutputMode } from "./shared/output.js"
import { assertRole } from "./shared/role.js"
import { locateTree } from "./shared/tree.js"
import type { AnyVerb, FlagSpec, VerbContext } from "./shared/verb.js"

interface GlobalOptions {
    readonly json?: boolean
    readonly cwd?: string
}

const globalsOf = (command: Command): GlobalOptions => command.optsWithGlobals<GlobalOptions>()

const modeOf = (options: GlobalOptions): OutputMode => (options.json === true ? "json" : "human")

/** Runs one verb: builds its context, calls the handler, prints the envelope and sets the exit code. */
const execute = async (verb: AnyVerb, command: Command, verbs: readonly AnyVerb[]): Promise<void> => {
    const options = globalsOf(command)
    const mode = modeOf(options)
    try {
        // Only the verb the caller typed is checked; what it runs inside (a step's task verify) is part of that verb.
        assertRole(verb)
        const cwd = resolve(options.cwd ?? process.cwd())
        const location = locateTree(cwd)
        const progress = (line: string): void => {
            if (mode === "human") process.stdout.write(`${line}\n`)
        }
        const context: VerbContext = { cwd, tree: location.tree, treeRoot: location.root, verbs, json: mode === "json", progress }
        const flags = command.opts<Record<string, string | boolean | readonly string[] | undefined>>()
        const positionals = Object.keys(verb.flags).filter((name) => verb.flags[name]?.positional === true || verb.flags[name]?.kind === "rest")
        const given = command.processedArgs as unknown[]
        const operand = (value: unknown, spec: FlagSpec | undefined): string | readonly string[] | undefined => {
            if (spec?.kind === "rest") return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
            return typeof value === "string" ? value : undefined
        }
        const positionalValues = Object.fromEntries(positionals.map((name, index) => [name, operand(given[index], verb.flags[name])]))
        // commander stores `--dry-run` as `dryRun` and `--no-commit` as a negated `commit`, so read each flag through its own option.
        const optionValue = (name: string, spec: FlagSpec): string | boolean | readonly string[] | undefined => {
            const option = command.options.find((candidate) => candidate.long === `--${name}`)
            const value = option === undefined ? undefined : flags[option.attributeName()]
            if (spec.kind === "list") return typeof value === "object" ? value : []
            if (spec.kind === "string") return typeof value === "string" ? value : undefined
            return option?.negate === true ? value === false : value === true
        }
        const values = Object.fromEntries(Object.entries(verb.flags).map(([name, spec]) => [name, spec.positional === true || spec.kind === "rest" ? positionalValues[name] : optionValue(name, spec)]))
        const result = await verb.run(context, values)
        printResult(mode, verb.schema, result)
        if (result.exitCode !== undefined) process.exitCode = result.exitCode
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        printRefusal(mode, refusal)
        process.exitCode = refusal.exitCode
    }
}

/** Adds one verb to the program, creating its group command on first use. */
const register = (program: Command, verb: AnyVerb, verbs: readonly AnyVerb[]): void => {
    const [first, second] = verb.path
    let parent = program
    let name = first
    if (second !== undefined) {
        parent = program.commands.find((command) => command.name() === first) ?? program.command(first).description(`${first} verbs`)
        name = second
    }
    const command = parent.command(name).description(verb.summary)
    for (const [flag, spec] of Object.entries(verb.flags)) {
        if (spec.kind === "rest") {
            command.argument(spec.required === true ? `<${flag}...>` : `[${flag}...]`, spec.summary)
            continue
        }
        if (spec.positional === true) {
            command.argument(spec.required === true ? `<${flag}>` : `[${flag}]`, spec.summary)
            continue
        }
        const spelling = spec.kind === "boolean" ? `--${flag}` : `--${flag} <value>`
        if (spec.kind === "list") command.option(spelling, spec.summary, (value: string, previous: readonly string[] | undefined) => [...(previous ?? []), value])
        else if (spec.required === true) command.requiredOption(spelling, spec.summary)
        else command.option(spelling, spec.summary)
    }
    command.action(async (...received: unknown[]) => {
        const self = received.at(-1)
        if (self instanceof Command) await execute(verb, self, verbs)
    })
}

/** Builds the program for the tree of the working directory; `--cwd` is honoured before the verbs are chosen. */
const buildProgram = (argv: readonly string[]): Command => {
    // Operands after `--` belong to the verb (a uat script's arguments), never to the CLI.
    const ours = argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv
    const cwdIndex = ours.indexOf("--cwd")
    const cwd = resolve(cwdIndex >= 0 ? ours[cwdIndex + 1] ?? process.cwd() : process.cwd())
    const verbs = verbsFor(locateTree(cwd).tree)
    const program = new Command("starci")
        .description("the StarCi command line: core verbs plus the verbs of this tree's edition")
        .option("--json", "print one json envelope instead of human text")
        .option("--cwd <path>", "run as if started in this directory")
        .configureOutput({ outputError: () => undefined })
        .exitOverride()
    for (const verb of verbs) register(program, verb, verbs)
    return program
}

const main = async (): Promise<void> => {
    const program = buildProgram(process.argv)
    try {
        await program.parseAsync(process.argv)
    } catch (error: unknown) {
        if (error instanceof CommanderError) {
            if (error.code === "commander.helpDisplayed" || error.code === "commander.help" || error.code === "commander.version") return
            printRefusal(process.argv.includes("--json") ? "json" : "human", new UsageError(`${error.message.replace(/^error: /, "")} (see starci <command> --help)`))
            process.exitCode = EXIT_USAGE
            return
        }
        throw error
    }
}

await main()
