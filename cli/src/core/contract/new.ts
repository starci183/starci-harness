import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { CONTRACT_SCHEMA, DEFAULT_BUDGET, contractProblems, parseContract, resolveChecks } from "../../harness/contract.js"
import { projectDir } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import type { CheckEntry } from "../../harness/ops.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot, resolveSha } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

const SLUG_CHARS = 48

type ArgValue = string | number | string[]

const list = (value: string | undefined): string[] => (value ?? "").split(",").map((path) => path.trim()).filter((path) => path !== "")

/** A file name from the task summary, so contracts of one project sit side by side in contracts/ of its state folder. */
/** Drops the dashes at both ends of a slug. */
const trimDashes = (text: string): string => {
    let start = 0
    let end = text.length
    while (start < end && text[start] === "-") start += 1
    while (end > start && text[end - 1] === "-") end -= 1
    return text.slice(start, end)
}

const slugOf = (summary: string): string => trimDashes(trimDashes(summary.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")).slice(0, SLUG_CHARS)) || "contract"

/**
 * One `--check` entry: `preset` or `preset:arg=value,arg=value`, where a value with `|` is a list (`keys=summary|files`);
 * or the entry written out as json (`{"preset":"tests-pass","args":{"command":"npm test"}}`).
 */
const parseCheck = (entry: string): CheckEntry => {
    if (entry.startsWith("{")) {
        try {
            return JSON.parse(entry) as CheckEntry
        } catch (error: unknown) {
            throw new Refusal("CLI_USAGE", `--check ${entry} is not json: ${error instanceof Error ? error.message : String(error)}`, EXIT_USAGE)
        }
    }
    const colon = entry.indexOf(":")
    if (colon < 0) return { preset: entry }
    const args: Record<string, ArgValue> = {}
    for (const pair of entry.slice(colon + 1).split(",")) {
        const equals = pair.indexOf("=")
        if (equals <= 0) throw new Refusal("CLI_USAGE", `--check ${entry}: "${pair}" is not arg=value`, EXIT_USAGE)
        const value = pair.slice(equals + 1).trim()
        args[pair.slice(0, equals).trim()] = value.includes("|") ? value.split("|").map((part) => part.trim()) : value
    }
    return { preset: entry.slice(0, colon).trim(), args }
}

/** `name=value;name=value` pairs, for --input and --output, where a value may hold commas. */
const pairs = (flag: string, value: string | undefined): [string, string][] =>
    (value ?? "")
        .split(";")
        .map((pair) => pair.trim())
        .filter((pair) => pair !== "")
        .map((pair): [string, string] => {
            const equals = pair.indexOf("=")
            if (equals <= 0) throw new Refusal("CLI_USAGE", `--${flag} ${pair}: write name=value`, EXIT_USAGE)
            return [pair.slice(0, equals).trim(), pair.slice(equals + 1).trim()]
        })

/** `starci contract new`: writes a contract that extends its label's op (ops/ops/<label>.md) and says whether it is fit. */
export const contractNewVerb = defineVerb({
    path: ["contract", "new"],
    summary: "write a contract for one task: its label's op file gives the base, --read, --input, --output and --check extend it; it says what still keeps it unfit",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor", "agent"],
    schema: "starci/contract-new@1",
    flags: {
        label: { kind: "string", summary: "the worker label (code, test, ui, verify, uat, docs, deliver)", required: true },
        summary: { kind: "string", summary: "what the task must do, in one sentence", required: true },
        allow: { kind: "string", summary: "comma-separated repository paths the task may write (literal folders or files, no globs)", required: true },
        read: { kind: "string", summary: "comma-separated files the task reads beyond its op's base: repository paths, or harness:<path> for a file of the harness" },
        input: { kind: "string", summary: "named inputs, \"name=value;name=value\": the op's base inputs (ops/ops/<label>.md) and any the task adds" },
        output: { kind: "string", summary: "output keys the result must carry beyond the op's base, \"key=type;key=type\" (string, number, boolean, object, array, string[])" },
        "cwd-path": { kind: "string", summary: "the repository folder the checks run in (default: the repository root)" },
        check: {
            kind: "string",
            summary: 'checks to add, separated by ";": preset or preset:arg=value,arg=value (a|b is a list), or {"preset":"tests-pass","args":{"command":"npm test"}}',
        },
        details: { kind: "string", summary: "more words on the input, beyond the summary" },
        base: { kind: "string", summary: "the revision the task starts from (default: HEAD)" },
        out: { kind: "string", summary: "the file to write (default: contracts/<summary>.json in the project's state folder under the state base)" },
        force: { kind: "boolean", summary: "overwrite an existing file" },
    },
    run: async (context, flags) => {
        const ops = loadOps()
        const op = ops.labels[flags.label]
        if (op === undefined) throw new Refusal("CONTRACT_UNKNOWN_LABEL", `unknown label ${flags.label}; labels: ${Object.keys(ops.labels).join(", ")}`)
        const root = await repositoryRoot(context.cwd)
        const given = (flags.check ?? "").split(";").map((entry) => entry.trim()).filter((entry) => entry !== "").map(parseCheck)
        const read = list(flags.read)
        const inputs = pairs("input", flags.input)
        const inputBase = Object.fromEntries(inputs.filter(([name]) => name in op.input.base))
        const inputExtend = Object.fromEntries(inputs.filter(([name]) => !(name in op.input.base)))
        const output = Object.fromEntries(pairs("output", flags.output))
        const raw = {
            schema: CONTRACT_SCHEMA,
            label: flags.label,
            context: {
                revision: await resolveSha(root, flags.base ?? "HEAD"),
                allowPaths: list(flags.allow),
                ...(flags["cwd-path"] === undefined ? {} : { cwd: flags["cwd-path"] }),
                ...(read.length === 0 ? {} : { extend: read }),
            },
            input: {
                summary: flags.summary,
                ...(flags.details === undefined ? {} : { details: flags.details }),
                ...(Object.keys(inputBase).length === 0 ? {} : { base: inputBase }),
                ...(Object.keys(inputExtend).length === 0 ? {} : { extend: inputExtend }),
            },
            ...(Object.keys(output).length === 0 ? {} : { output: { extend: output } }),
            ...(given.length === 0 ? {} : { checks: { extend: given } }),
            budget: { ...DEFAULT_BUDGET },
        }
        // Through the schema, so the file holds the same normalised paths every reader will see.
        const contract = parseContract(raw)
        const slugFile = `${slugOf(flags.summary)}.json`
        const out = flags.out === undefined ? join(projectDir(root), "contracts", slugFile) : resolve(context.cwd, flags.out)
        if (existsSync(out) && !flags.force) throw new Refusal("CONTRACT_EXISTS", `${out} exists; pass --force to overwrite, or --out <file>`)
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`)
        const problems = contractProblems(contract, ops)
        const problemLines = problems.map((problem) => `- ${problem}`).join("\n")
        const verdict = problems.length === 0 ? "fit to send" : `not fit yet:\n${problemLines}`
        const checkCount = problems.length === 0 ? ` with ${String(resolveChecks(contract, ops).length)} check(s), base and extend` : ""
        return { data: { file: out, contract, fit: problems.length === 0, problems }, message: `wrote ${out}${checkCount}; ${verdict}` }
    },
})
