#!/usr/bin/env node
import { resolve } from "node:path"
import { asRefusal, UsageError } from "../../shared/errors.js"
import { printRefusal, printResult } from "../../shared/output.js"
import { assertRole } from "../../shared/role.js"
import { locateTree } from "../../shared/tree.js"
import type { AnyVerb, RawFlagValues, VerbContext } from "../../shared/verb.js"
import { benchListVerb } from "./list.js"
import { benchRunVerb } from "./run.js"

// The bench verbs run through this entry until registry.ts lists them (`node cli/dist/core/bench/entry.js run --all`); the
// flags are parsed by the verbs' own specs, so the entry and `starci bench ...` take the same command line.
const verbs: readonly AnyVerb[] = [benchRunVerb as unknown as AnyVerb, benchListVerb as unknown as AnyVerb]

const parse = (verb: AnyVerb, args: readonly string[]): RawFlagValues => {
    const values: Record<string, string | boolean | undefined> = {}
    const positional = Object.keys(verb.flags).find((name) => verb.flags[name]?.positional === true)
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index] ?? ""
        if (!arg.startsWith("--")) {
            if (positional === undefined || values[positional] !== undefined) throw new UsageError(`unexpected operand ${arg}`)
            values[positional] = arg
            continue
        }
        const name = arg.slice(2)
        const spec = verb.flags[name]
        if (spec === undefined) throw new UsageError(`unknown flag ${arg}`)
        if (spec.kind === "boolean") values[name] = true
        else {
            values[name] = args[index + 1]
            index += 1
        }
    }
    for (const name of Object.keys(verb.flags)) if (verb.flags[name]?.kind === "boolean") values[name] = values[name] === true
    return values
}

const main = async (): Promise<void> => {
    const argv = process.argv.slice(2)
    const json = argv.includes("--json")
    const rest = argv.filter((arg) => arg !== "--json")
    const mode = json ? "json" : "human"
    const verb = verbs.find((candidate) => candidate.path[1] === rest[0])
    try {
        if (verb === undefined) throw new UsageError("usage: entry.js run <id>|--all [--fault <name>] [--record] | list [--group <g>] [--json]")
        assertRole(verb)
        const cwd = resolve(process.cwd())
        const location = locateTree(cwd)
        const context: VerbContext = { cwd, tree: location.tree, treeRoot: location.root, verbs, progress: (line) => (mode === "human" ? process.stdout.write(`${line}\n`) : undefined) }
        const result = await verb.run(context, parse(verb, rest.slice(1)))
        printResult(mode, verb.schema, result)
        if (result.exitCode !== undefined) process.exitCode = result.exitCode
    } catch (error: unknown) {
        const refusal = asRefusal(error)
        printRefusal(mode, refusal)
        process.exitCode = refusal.exitCode
    }
}

await main()
