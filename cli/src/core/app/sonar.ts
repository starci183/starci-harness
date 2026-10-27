import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, WRITERS, defineVerb } from "../../shared/verb.js"
import { SONAR_FILE, appFacts, blockKeys, blockMatches, sonarBlock, spliceBlock } from "../check/sonar-scope.js"

interface AppSonarData {
    readonly file: string
    readonly mode: "print" | "check" | "write"
    readonly verdict: "printed" | "green" | "drift" | "written"
    readonly block: readonly string[]
    /** Lines outside the block that set a key the block sets (1-based). */
    readonly shadowed: readonly number[]
}

/**
 * `starci app sonar`: the Sonar scope block of an app's sonar-project.properties, derived from the slots of its edition
 * (core/check/sonar-scope.ts). `--write` puts it in place between its markers; `--check` exits 1 when the file's block
 * differs or a line outside it sets one of its keys. `check loosening` accepts exactly this block and nothing else.
 */
export const appSonarVerb = defineVerb({
    path: ["app", "sonar"],
    summary: "derive the Sonar scope block of sonar-project.properties from the HFS slots of this app's edition; --check fails on drift, --write puts it in place",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-sonar@1",
    flags: {
        check: { kind: "boolean", summary: "exit 1 when the file's generated block differs from the derivation or a line outside it sets one of its keys" },
        write: { kind: "boolean", summary: "write the block between its markers, dropping hand-written lines of the keys it sets" },
    },
    run: (context, flags) => {
        if (flags.check && flags.write) throw new Refusal("FLAGS_EXCLUSIVE", "pass --check or --write, not both")
        const root = context.treeRoot
        const app = root === undefined ? undefined : appFacts(root)
        if (root === undefined || app === undefined) throw new Refusal("APP_NOT_FOUND", "run this inside an app (an hfs.json with kind app)")
        const file = join(root, SONAR_FILE)
        const block = sonarBlock(app)
        if (!flags.check && !flags.write) {
            return Promise.resolve({ data: { file, mode: "print", verdict: "printed", block, shadowed: [] } satisfies AppSonarData, message: block.join("\n") })
        }
        const text = existsSync(file) ? readFileSync(file, "utf8") : ""
        if (flags.write) {
            writeFileSync(file, spliceBlock(text, block))
            return Promise.resolve({ data: { file, mode: "write", verdict: "written", block, shadowed: [] } satisfies AppSonarData, message: `wrote the generated Sonar block of ${file}` })
        }
        const lines = text.split("\n")
        const keys = blockKeys(block)
        const begin = lines.findIndex((line) => line.trimEnd() === block[0])
        const shadowed = lines.flatMap((line, index) => {
            const key = /^\s*([\w.-]+)\s*[=:]/.exec(line)?.[1]
            const inside = begin !== -1 && index > begin && index < begin + block.length - 1
            return key !== undefined && keys.includes(key) && !inside ? [index + 1] : []
        })
        const green = blockMatches(lines, block) && shadowed.length === 0
        const data: AppSonarData = { file, mode: "check", verdict: green ? "green" : "drift", block, shadowed }
        const drift = blockMatches(lines, block) ? "sets " + keys.join(", ") + " outside the block on line(s) " + shadowed.join(", ") : "lacks the generated Sonar block or it differs"
        const message = green ? `green: ${file} carries the generated Sonar block` : `drift: ${file} ${drift}; run \`starci app sonar --write\``
        return Promise.resolve({ data, message, exitCode: green ? 0 : 1 })
    },
})
