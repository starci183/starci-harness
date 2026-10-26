import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { contractProblems, parseContract } from "../../harness/contract.js"
import type { Contract } from "../../harness/contract.js"
import { ensureWorkDir } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { repositoryRoot, resolveSha } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

const DEFAULT_MINUTES = 60

const DEFAULT_TRIES = 3

const SLUG_CHARS = 48

type CheckEntry = Contract["expectedOutput"]["checks"][number]

type ArgValue = string | number | string[]

const list = (value: string | undefined): string[] => (value ?? "").split(",").map((path) => path.trim()).filter((path) => path !== "")

/** A file name from the task summary, so contracts of one project sit side by side under .starciwork/contracts. */
const slugOf = (summary: string): string =>
    summary
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, SLUG_CHARS)
        .replace(/-+$/, "") || "contract"

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

/** `starci contract new`: writes a contract with the label's default checks plus the given ones, and says whether it is fit. */
export const contractNewVerb = defineVerb({
    path: ["contract", "new"],
    summary: "write a contract for one task with its label's default checks plus --check presets; it says what still keeps it unfit",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor", "agent"],
    schema: "starci/contract-new@1",
    flags: {
        label: { kind: "string", summary: "the worker label (code, test, ui, verify, uat, docs, deliver)", required: true },
        summary: { kind: "string", summary: "what the task must do, in one sentence", required: true },
        allow: { kind: "string", summary: "comma-separated repository paths the task may write (literal folders or files, no globs)", required: true },
        read: { kind: "string", summary: "comma-separated repository paths the task should read" },
        "cwd-path": { kind: "string", summary: "the repository folder the checks run in (default: the repository root)" },
        check: {
            kind: "string",
            summary: 'checks to add, separated by ";": preset or preset:arg=value,arg=value (a|b is a list), or {"preset":"tests-pass","args":{"command":"npm test"}}',
        },
        details: { kind: "string", summary: "more words on the input, beyond the summary" },
        base: { kind: "string", summary: "the base revision (default: HEAD)" },
        out: { kind: "string", summary: "the file to write (default: .starciwork/contracts/<summary>.json of the project)" },
        force: { kind: "boolean", summary: "overwrite an existing file" },
    },
    run: async (context, flags) => {
        const ops = loadOps()
        const label = ops.labels[flags.label]
        if (label === undefined) throw new Refusal("CONTRACT_UNKNOWN_LABEL", `unknown label ${flags.label}; labels: ${Object.keys(ops.labels).join(", ")}`)
        const root = await repositoryRoot(context.cwd)
        const given = (flags.check ?? "").split(";").map((entry) => entry.trim()).filter((entry) => entry !== "").map(parseCheck)
        const named = new Set(given.map((entry) => ("preset" in entry ? entry.preset : "")))
        const read = list(flags.read)
        const raw: Contract = {
            schema: "starci/contract@1",
            label: flags.label,
            context: {
                base: await resolveSha(root, flags.base ?? "HEAD"),
                allowPaths: list(flags.allow),
                ...(read.length === 0 ? {} : { readPaths: read }),
                ...(flags["cwd-path"] === undefined ? {} : { cwd: flags["cwd-path"] }),
            },
            input: { summary: flags.summary, ...(flags.details === undefined ? {} : { details: flags.details }) },
            expectedOutput: { checks: [...label.defaultChecks.filter((preset) => !named.has(preset)).map((preset) => ({ preset })), ...given] },
            budget: { minutes: DEFAULT_MINUTES, tries: DEFAULT_TRIES },
        }
        // Through the schema, so the file holds the same normalised paths every reader will see.
        const contract = parseContract(raw)
        const out = flags.out === undefined ? join(ensureWorkDir(root), "contracts", `${slugOf(flags.summary)}.json`) : resolve(context.cwd, flags.out)
        if (existsSync(out) && !flags.force) throw new Refusal("CONTRACT_EXISTS", `${out} exists; pass --force to overwrite, or --out <file>`)
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`)
        const problems = contractProblems(contract, ops)
        const verdict = problems.length === 0 ? "fit to send" : `not fit yet:\n${problems.map((problem) => `- ${problem}`).join("\n")}`
        return { data: { file: out, contract, fit: problems.length === 0, problems }, message: `wrote ${out} with ${String(contract.expectedOutput.checks.length)} check(s); ${verdict}` }
    },
})
