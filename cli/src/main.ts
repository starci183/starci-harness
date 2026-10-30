#!/usr/bin/env node
import { resolve } from "node:path"
import { Command, CommanderError } from "commander"
import { recordSpawn } from "./harness/reap.js"
import { verbsFor } from "./registry.js"
import { observeSpawns } from "./shared/exec.js"
import { asRefusal, EXIT_USAGE, UsageError } from "./shared/errors.js"
import { printRefusal, printResult } from "./shared/output.js"
import type { OutputMode } from "./shared/output.js"
import { assertRole } from "./shared/role.js"
import { locateTree } from "./shared/tree.js"
import { spellingOf } from "./shared/verb.js"
import type { AnyVerb, FlagSpec, RawFlagValues, VerbContext } from "./shared/verb.js"

interface GlobalOptions {
    readonly json?: boolean
    readonly cwd?: string
}

const globalsOf = (command: Command): GlobalOptions => command.optsWithGlobals<GlobalOptions>()

const modeOf = (options: GlobalOptions): OutputMode => (options.json === true ? "json" : "human")

/** Whether a verb declares the CLI's `--cwd` as its own flag, and so runs in the caller's directory. */
const ownsCwd = (verb: AnyVerb): boolean => verb.flags.cwd !== undefined

/** Runs one verb with its flag values: builds its context, calls the handler, prints the envelope and sets the exit code. */
const run = async (verb: AnyVerb, options: GlobalOptions, verbs: readonly AnyVerb[], values: (context: VerbContext) => RawFlagValues): Promise<void> => {
    const mode = modeOf(options)
    try {
        // Only the verb the caller typed is checked; what it runs inside (a step's task verify) is part of that verb.
        assertRole(verb)
        const cwd = resolve(ownsCwd(verb) ? process.cwd() : (options.cwd ?? process.cwd()))
        const location = locateTree(cwd)
        const progress = (line: string): void => {
            if (mode === "human") process.stdout.write(`${line}\n`)
        }
        const context: VerbContext = { cwd, tree: location.tree, treeRoot: location.root, verbs, json: mode === "json", progress }
        const result = await verb.run(context, values(context))
        printResult(mode, verb.schema, result)
        if (result.exitCode !== undefined) process.exitCode = result.exitCode
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        printRefusal(mode, refusal)
        process.exitCode = refusal.exitCode
    }
}

/** Runs one verb commander parsed: its positionals and options, read through each flag's own spec. */
const execute = async (verb: AnyVerb, command: Command, verbs: readonly AnyVerb[]): Promise<void> => {
    const options = globalsOf(command)
    const flags = command.opts<Record<string, string | boolean | readonly string[] | undefined>>()
    const positionals = Object.keys(verb.flags).filter((name) => verb.flags[name]?.positional === true || verb.flags[name]?.kind === "rest")
    const given = command.processedArgs as unknown[]
    const operand = (value: unknown, spec: FlagSpec | undefined): string | readonly string[] | undefined => {
        if (spec?.kind === "rest") return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
        return typeof value === "string" ? value : undefined
    }
    const positionalValues = Object.fromEntries(positionals.map((name, index) => [name, operand(given[index], verb.flags[name])]))
    // commander stores `--max-ticks` as `maxTicks` and `--no-commit` as a negated `commit`, so read each flag through its own option.
    const optionValue = (name: string, spec: FlagSpec): string | boolean | readonly string[] | undefined => {
        // The CLI's own --cwd is parsed by the program, whatever verb declares it.
        if (name === "cwd") return options.cwd
        const option = command.options.find((candidate) => candidate.long === `--${name}`)
        const value = option === undefined ? undefined : flags[option.attributeName()]
        if (spec.kind === "list") return typeof value === "object" ? value : []
        if (spec.kind === "string") return typeof value === "string" ? value : undefined
        return option?.negate === true ? value === false : value === true
    }
    const values = Object.fromEntries(Object.entries(verb.flags).map(([name, spec]) => [name, spec.positional === true || spec.kind === "rest" ? positionalValues[name] : optionValue(name, spec)]))
    await run(verb, options, verbs, () => values)
}

/** Adds one flag to a verb's command: a rest or positional flag as an argument, any other as an option. */
const addFlag = (command: Command, flag: string, spec: FlagSpec): void => {
    if (spec.kind === "rest") {
        command.argument(spec.required === true ? `<${flag}...>` : `[${flag}...]`, spec.summary)
        return
    }
    if (spec.positional === true) {
        command.argument(spec.required === true ? `<${flag}>` : `[${flag}]`, spec.summary)
        return
    }
    const spelling = spec.kind === "boolean" ? `--${flag}` : `--${flag} <value>`
    if (spec.kind === "list") command.option(spelling, spec.summary, (value: string, previous: readonly string[] | undefined) => [...(previous ?? []), value])
    else if (spec.required === true) command.requiredOption(spelling, spec.summary)
    else command.option(spelling, spec.summary)
}

/** Adds one verb to the program, creating its group command on first use; its help is generated from its definition and the retired map. */
const register = (program: Command, verb: AnyVerb, verbs: readonly AnyVerb[]): void => {
    const [first, second] = verb.path
    let parent = program
    let name = first
    if (second !== undefined) {
        parent = program.commands.find((command) => command.name() === first) ?? program.command(first).description(`${first} verbs`)
        name = second
    }
    const command = parent.command(name).description(verb.summary)
    for (const [flag, spec] of Object.entries(verb.flags)) addFlag(command, flag, spec)
    if (verb.forward === true) command.addHelpText("after", ["", `Every argument is @starci/hfs's: starci ${spellingOf(verb)} --help prints its flags.`].join("\n"))
    command.action(async (...received: unknown[]) => {
        const self = received.at(-1)
        if (self instanceof Command) await execute(verb, self, verbs)
    })
}

/** Takes the CLI's own options (`--json`, `--cwd <dir>`) out of an argv; what is left belongs to the verb. */
const splitGlobals = (argv: readonly string[]): { readonly options: GlobalOptions; readonly rest: readonly string[] } => {
    const rest: string[] = []
    let json = false
    let cwd: string | undefined
    for (let at = 0; at < argv.length; at += 1) {
        const token = argv[at] ?? ""
        if (token === "--") {
            rest.push(...argv.slice(at))
            break
        }
        if (token === "--json") json = true
        else if (token.startsWith("--cwd=")) cwd = token.slice("--cwd=".length)
        else if (token === "--cwd") {
            cwd = argv[at + 1]
            at += 1
        } else rest.push(token)
    }
    return { options: { json, ...(cwd === undefined ? {} : { cwd }) }, rest }
}

/**
 * The forwarded verb a command line names (`starci app <verb> ...`) with the arguments it hands @starci/hfs as typed, or
 * undefined when it names another verb (commander parses those).
 */
const forwardedOf = (argv: readonly string[], verbs: readonly AnyVerb[]): { readonly verb: AnyVerb; readonly options: GlobalOptions; readonly args: readonly string[] } | undefined => {
    const { options, rest } = splitGlobals(argv)
    const verb = verbs.find((candidate) => candidate.forward === true && candidate.path[0] === rest[0] && candidate.path[1] === rest[1])
    return verb === undefined ? undefined : { verb, options, args: rest.slice(verb.path.length) }
}

/** Builds the program for the tree of the working directory; `--cwd` is honoured before the verbs are chosen. */
const buildProgram = (argv: readonly string[]): { readonly program: Command; readonly verbs: readonly AnyVerb[] } => {
    // Operands after `--` belong to the verb (a uat script's arguments), never to the CLI.
    const ours = argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv
    const { options } = splitGlobals(ours)
    const cwd = resolve(options.cwd ?? process.cwd())
    const verbs = verbsFor(locateTree(cwd).tree)
    const program = new Command("starci")
        .description("the StarCi command line: core verbs plus the verbs of this tree's edition")
        .option("--json", "print one json envelope instead of human text")
        .option("--cwd <path>", "run as if started in this directory (a verb that lists --cwd takes it as its own folder)")
        .configureHelp({ showGlobalOptions: true })
        .configureOutput({ outputError: () => undefined })
        .exitOverride()
    for (const verb of verbs) register(program, verb, verbs)
    return { program, verbs }
}

const main = async (): Promise<void> => {
    const json = process.argv.includes("--json")
    const argv: readonly string[] = process.argv.slice(2)
    const { program, verbs } = buildProgram(argv)
    const forwarded = forwardedOf(argv, verbs)
    if (forwarded !== undefined) {
        await run(forwarded.verb, forwarded.options, verbs, () => ({ args: forwarded.args }))
        return
    }
    try {
        await program.parseAsync([...process.argv.slice(0, 2), ...argv])
    } catch (error: unknown) {
        if (error instanceof CommanderError) {
            if (error.code === "commander.helpDisplayed" || error.code === "commander.help" || error.code === "commander.version") return
            printRefusal(json ? "json" : "human", new UsageError(`${error.message.replace(/^error: /, "")} (see starci <command> --help)`))
            process.exitCode = EXIT_USAGE
            return
        }
        throw error
    }
}

/**
 * The last resort of a failure no verb caught (an error event nobody listens to, a promise nobody awaits): the caller still gets
 * the refusal, as the json envelope under --json, and exit 1, never a silent exit. Printed once; stdout is flushed before exit.
 */
let failed = false
const lastResort = (error: unknown): void => {
    if (failed) return
    failed = true
    const refusal = asRefusal(error)
    const json = process.argv.includes("--json")
    const text = json ? `${JSON.stringify({ schema: "starci/refusal@1", ok: false, code: refusal.code, message: refusal.message }, null, 2)}
` : `${refusal.code}: ${refusal.message}
`
    const stream = json ? process.stdout : process.stderr
    stream.write(text, () => process.exit(1))
}
process.on("uncaughtException", lastResort)
process.on("unhandledRejection", lastResort)
// Every process the CLI starts inside an Op worktree is recorded, so the worktree's removal ends it (harness/reap.ts).
observeSpawns(recordSpawn)

await main()
