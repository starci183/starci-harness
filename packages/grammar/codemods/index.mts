/**
 * THE GRAMMAR CODEMODS (owner, 2026-11-21: "starci app codemod v0540 đi pattern thế 1 codemod đi kèm 1 bản grammars").
 * One codemod goes with one Grammar release that needs it, named after that version: 0.54.0 is `v0540` (`v<major><minor><patch>`).
 * They ship in the package (`@starci/grammar/codemods`, built to dist/codemods), and `starci app codemod` loads them from the
 * Grammar the app has installed, handing in the app's own TypeScript compiler.
 */
import type Compiler from "typescript"
import { runV0540, v0540Markdown, type V0540Report } from "./v0540/index.mts"

/** What one codemod run reports: its findings are the cases left for a person. */
export interface GrammarCodemodReport {
    readonly codemod: string
    readonly version: string
    readonly mode: "dry" | "execute"
    readonly findings: readonly unknown[]
}

/** One codemod of the Grammar. */
export interface GrammarCodemod {
    /** `v<major><minor><patch>` of `version`. */
    readonly id: string
    /** The Grammar version that needs it. */
    readonly version: string
    readonly summary: string
    readonly run: (input: { readonly root: string; readonly write: boolean; readonly ts: typeof Compiler }) => GrammarCodemodReport
    /** The Markdown of a report this codemod returned. */
    readonly markdown: (report: GrammarCodemodReport) => string
}

/** The id of the codemod of a Grammar version: 0.54.0 is v0540. */
export const codemodId = (version: string): string => `v${version.split(".").join("")}`

/** Every codemod, in version order. */
export const CODEMODS: readonly GrammarCodemod[] = Object.freeze([
    {
        id: "v0540",
        version: "0.54.0",
        summary: "the type roles: Tailwind text-size utilities become starci-type-<role> classes and <Text size isStrong mono> becomes <Text role>",
        run: runV0540,
        markdown: (report) => v0540Markdown(report as V0540Report),
    },
])

const parts = (version: string): number[] => version.split(".").map(Number)

/** -1, 0 or 1 as `a` is below, at or above `b` (x.y.z). */
export const compareVersions = (a: string, b: string): number => {
    const [x, y] = [parts(a), parts(b)]
    for (let i = 0; i < 3; i += 1) {
        const d = (x[i] ?? 0) - (y[i] ?? 0)
        if (d !== 0) return Math.sign(d)
    }
    return 0
}

/** The codemods an upgrade from `from` (installed) to `to` (target) needs: above `from`, up to and including `to`, in version order. */
export const codemodsBetween = (from: string, to: string): GrammarCodemod[] =>
    CODEMODS.filter((codemod) => compareVersions(codemod.version, from) > 0 && compareVersions(codemod.version, to) <= 0)
