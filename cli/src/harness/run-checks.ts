import { existsSync, globSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { captureCommand, captureTool } from "../shared/exec.js"
import type { ToolRun } from "../shared/exec.js"
import { changedFiles } from "../shared/git.js"
import type { Contract, ResolvedCheck } from "./contract.js"

/** The verdict of one check. */
export interface CheckOutcome {
    readonly name: string
    readonly kind: string
    readonly status: "green" | "red"
    readonly exitCode: number | null
    readonly detail: string
}

/** Where the checks of one contract run: the repository root and the contract's working folder. */
export interface CheckPlace {
    readonly root: string
    readonly cwd: string
}

const DETAIL_LINES = 30

const PROBE_TIMEOUT_MS = 10_000

const tailOf = (run: ToolRun): string => [run.stdout, run.stderr].filter((text) => text !== "").join("\n").split("\n").slice(-DETAIL_LINES).join("\n")

/** This CLI's own entry, so a `starci` check runs the same build that verifies. */
const selfEntry = (): string => fileURLToPath(new URL("../main.js", import.meta.url))

const fromRun = (check: ResolvedCheck, run: ToolRun): CheckOutcome => ({
    name: check.name,
    kind: check.check.kind,
    status: run.exitCode === 0 ? "green" : "red",
    exitCode: run.exitCode,
    detail: tailOf(run),
})

const outcome = (check: ResolvedCheck, problems: readonly string[], greenDetail: string): CheckOutcome => ({
    name: check.name,
    kind: check.check.kind,
    status: problems.length === 0 ? "green" : "red",
    exitCode: null,
    detail: problems.length === 0 ? greenDetail : problems.join("\n"),
})

const underAllowPaths = (file: string, allowPaths: readonly string[]): boolean =>
    allowPaths.some((allowed) => {
        const prefix = allowed.replace(/\\/g, "/").replace(/\/$/, "")
        return file === prefix || file.startsWith(`${prefix}/`)
    })

const runFilesCheck = async (check: ResolvedCheck & { readonly check: { readonly kind: "files" } }, contract: Contract, place: CheckPlace): Promise<CheckOutcome> => {
    const problems: string[] = []
    if (check.check.onlyAllowPaths === true) {
        const outside = (await changedFiles(place.root, contract.context.base)).filter((file) => !underAllowPaths(file, contract.context.allowPaths))
        if (outside.length > 0) problems.push(`changed outside allowPaths: ${outside.slice(0, 20).join(", ")}`)
    }
    for (const pattern of check.check.mustExist ?? []) {
        const present = /[*?[\]{}]/.test(pattern) ? globSync(pattern, { cwd: place.cwd }).length > 0 : existsSync(join(place.cwd, pattern))
        if (!present) problems.push(`missing: ${pattern}`)
    }
    return outcome(check, problems, "files as expected")
}

const runJsonCheck = (check: ResolvedCheck & { readonly check: { readonly kind: "json" } }, place: CheckPlace): CheckOutcome => {
    const file = join(place.cwd, check.check.file)
    if (!existsSync(file)) return outcome(check, [`missing: ${check.check.file}`], "")
    try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
        const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
        const missing = check.check.requiredKeys.filter((key) => !(key in record))
        return outcome(check, missing.length === 0 ? [] : [`${check.check.file} lacks keys: ${missing.join(", ")}`], `${check.check.file} carries ${String(check.check.requiredKeys.length)} required key(s)`)
    } catch (error: unknown) {
        return outcome(check, [`${check.check.file} is not json: ${error instanceof Error ? error.message : String(error)}`], "")
    }
}

const runProbeCheck = async (check: ResolvedCheck & { readonly check: { readonly kind: "probe" } }): Promise<CheckOutcome> => {
    try {
        const response = await fetch(check.check.url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
        const expected = check.check.status
        return outcome(check, response.status === expected ? [] : [`${check.check.url} answered ${String(response.status)}, expected ${String(expected)}`], `${check.check.url} answered ${String(expected)}`)
    } catch (error: unknown) {
        return outcome(check, [`${check.check.url} unreachable: ${error instanceof Error ? error.message : String(error)}`], "")
    }
}

/** Runs one primitive check of a contract. A missing tool or file is a red check, never a crash of the verify. */
export const runCheck = async (check: ResolvedCheck, contract: Contract, place: CheckPlace): Promise<CheckOutcome> => {
    const primitive = check.check
    switch (primitive.kind) {
        case "starci":
            return fromRun(check, await captureTool(process.execPath, [selfEntry(), "--cwd", place.cwd, ...primitive.args], place.cwd))
        case "command": {
            const argv = Array.isArray(primitive.run) ? primitive.run : primitive.run.split(/\s+/).filter((part) => part !== "")
            try {
                return fromRun(check, await captureCommand(argv, place.cwd))
            } catch (error: unknown) {
                return outcome(check, [error instanceof Error ? error.message : String(error)], "")
            }
        }
        case "files":
            return runFilesCheck({ ...check, check: primitive }, contract, place)
        case "json":
            return runJsonCheck({ ...check, check: primitive }, place)
        case "probe":
            return runProbeCheck({ ...check, check: primitive })
    }
}
