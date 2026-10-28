import { globSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { runtimeRoot } from "../../harness/ledger.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** A call that spawns a process through the CLI's runner (shared/exec.ts). */
const SPAWN = /\b(?:captureNpm|runNpm|captureCommand|captureTool|runTool|captureToolSync)\(/

/** npm calls that read or publish metadata and build nothing: light, so they take no slot. */
const LIGHT_NPM = /\b(?:captureNpm|runNpm)\(\s*\[\s*"(?:view|pack|publish|--version)"/

/** A tool spawn that is heavy whatever runs it: a compiler, a linter, a test runner, a bundler, a browser run or a container build or run. */
const HEAVY_TOOL = /\b(?:tsc|eslint|jest|vitest|playwright|next|webpack)\b|"docker",\s*(?:\["(?:build|run)"|args\b)/

/** The files that define the runner and the governor themselves. */
const OWNERS = new Set(["shared/exec.ts", "harness/heavy.ts"])

/** One spawn site that runs a heavy command outside the governor. */
interface Bypass {
    readonly file: string
    readonly line: number
    readonly text: string
}

/**
 * The spawn sites of the CLI's own source that run a heavy command without a heavy-command slot: an npm call that is not light,
 * a command check's argv, or a tool spawn naming a heavy tool, on a line that does not go through `withHeavySlot`.
 */
export const heavyBypasses = (source: string): Bypass[] =>
    globSync("**/*.ts", { cwd: source })
        .map((file) => file.replaceAll("\\", "/"))
        .filter((file) => !OWNERS.has(file))
        .flatMap((file) =>
            readFileSync(join(source, file), "utf8")
                .split("\n")
                .flatMap((text, index): Bypass[] => {
                    if (!SPAWN.test(text) || text.includes("withHeavySlot(") || /^\s*(?:\/\/|\*)/.test(text)) return []
                    const npm = /\b(?:captureNpm|runNpm|captureCommand)\(/.test(text) && !LIGHT_NPM.test(text)
                    return npm || HEAVY_TOOL.test(text) ? [{ file, line: index + 1, text: text.trim() }] : []
                }),
        )

/** `starci check heavy-sites`: every heavy command the CLI spawns goes through the host governor (harness/heavy.ts); red names each bypass. */
export const checkHeavySitesVerb = defineVerb({
    path: ["check", "heavy-sites"],
    summary: "audit the CLI's source: every spawn of a heavy command (an npm install or build, a command check, tsc, eslint, a test runner, a container) goes through the host heavy-command governor; red names each site that bypasses it",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-heavy-sites@1",
    flags: {},
    run: () => {
        const source = join(runtimeRoot(), "cli", "src")
        const bypasses = heavyBypasses(source)
        const lines = bypasses.length === 0 ? ["every heavy spawn site goes through the governor"] : bypasses.map((site) => `${site.file}:${String(site.line)}: ${site.text}`)
        return Promise.resolve({ data: { source, bypasses, verdict: bypasses.length === 0 ? "green" : "red" }, message: [...lines, `verdict: ${bypasses.length === 0 ? "green" : "red"}`].join("\n"), exitCode: bypasses.length === 0 ? 0 : 1 })
    },
})
