import type { LooseningMarker } from "../../harness/policy.js"
import { blockMatches, findBlock } from "./sonar-scope.js"

/** One gate-widening hit of a properties file (the shape of markers.ts MarkerHit). */
interface PropertyHit {
    readonly marker: LooseningMarker
    readonly line: number
    readonly label: string
}

/** One logical property: key, value, and the 0-based line it starts on (a trailing `\` continues it). */
interface Property {
    readonly key: string
    readonly value: string
    readonly line: number
}

/** The logical properties of a file read with its comments blanked. */
const propertiesOf = (lines: readonly string[]): Property[] => {
    const result: Property[] = []
    let start = -1
    let buffer = ""
    lines.forEach((raw, index) => {
        const line = raw.replace(/\r$/, "")
        if (start === -1) {
            if (line.trim() === "") return
            start = index
            buffer = line.trim()
        } else buffer += line.trim()
        if (buffer.endsWith("\\")) {
            buffer = buffer.slice(0, -1)
            return
        }
        const cut = /[=:]/.exec(buffer)
        if (cut !== null) result.push({ key: buffer.slice(0, cut.index).trim(), value: buffer.slice(cut.index + 1).trim(), line: start })
        start = -1
        buffer = ""
    })
    return result
}

const listOf = (value: string | undefined): string[] => (value ?? "").split(",").map((item) => item.trim()).filter((item) => item !== "")

const EXCLUSION_KEY = /^sonar\.(?:[\w-]+\.)*exclusions$/

/** Folders that hold dependencies or build output, never source: excluding them from Sonar widens no gate. */
export const NON_SOURCE_DIRS = String.raw`node_modules|\.next|dist|build|out|coverage|\.turbo|__generated__`

/** An exclusion entry that names only dependencies or build output. */
const NON_SOURCE_ENTRY = new RegExp(String.raw`^(?:\*\*\/)?(?:${NON_SOURCE_DIRS})\/\*\*$`)

/** Whether every directory of `sonar.sources` lies inside one of `sonar.tests`, so a test file excluded from sources stays analysed. */
const testsCoverSources = (sources: readonly string[], tests: readonly string[]): boolean =>
    sources.length > 0 && sources.every((source) => tests.some((test) => source === test || source.startsWith(`${test}/`)))

/**
 * The Sonar scope exclusions of a properties file that widen a gate. An entry narrows nothing when it names only
 * dependencies or build output, or when `sonar.exclusions` moves a file `sonar.test.inclusions` also names from the sources
 * to the tests and `sonar.tests` covers every source directory. The generated block (sonar-scope.ts) is accepted only when
 * it equals what `starci app sonar` writes for the file's app (`block`), line for line; edited or stale, it is judged like
 * any hand-written line. `code` is the file with comments blanked, `raw` the file as it stands.
 */
export const judgeSonarProperties = (code: readonly string[], raw: readonly string[], block: readonly string[] | undefined): PropertyHit[] => {
    const properties = propertiesOf(code)
    const value = (key: string): string | undefined => properties.findLast((property) => property.key === key)?.value
    const testInclusions = new Set(listOf(value("sonar.test.inclusions")))
    const covered = testsCoverSources(listOf(value("sonar.sources")), listOf(value("sonar.tests")))
    const found = findBlock(raw)
    const generated = block !== undefined && blockMatches(raw, block) && found !== undefined ? found : undefined
    const inBlock = (line: number): boolean => found !== undefined && line > found.begin && (found.end === -1 || line < found.end)
    const hits: PropertyHit[] = []
    for (const property of properties) {
        if (!EXCLUSION_KEY.test(property.key)) continue
        if (generated !== undefined && property.line > generated.begin && property.line < generated.end) continue
        const widening = listOf(property.value).filter((entry) => !NON_SOURCE_ENTRY.test(entry) && !(property.key === "sonar.exclusions" && covered && testInclusions.has(entry)))
        if (widening.length === 0) continue
        const shown = widening.slice(0, 3).join(", ") + (widening.length > 3 ? `, +${String(widening.length - 3)}` : "")
        const label = inBlock(property.line)
            ? `a generated Sonar block that differs from what \`starci app sonar\` writes for this app; run it with --write (${shown})`
            : `a Sonar scope exclusion outside the generated block (${shown})`
        hits.push({ marker: "gate-widening", line: property.line + 1, label })
    }
    return hits
}
