import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The Grammar takes no tests and no shots (contexts/ui/proof.md GRAMMAR-NO-TESTS): a change to a component is proven by what the lane
 * writes beside it, read in review (contexts/grammars/contributing.md "Proof by reading"): a story under src/stories/ that names the
 * component, and the component's row in contexts/grammars/contract.yaml or its section in the family's context (common.md, core.md,
 * offset-pop.md). This reads the files a lane changed and names each component whose records did not move with it. It is a notice for
 * the reviewer, never a finding: a rename or a comment fix moves no contract, and only a reader can tell. Pure but for reading the
 * changed stories from the tree.
 */

const GRAMMAR_SRC = "packages/grammar/src/"
const STORIES = `${GRAMMAR_SRC}stories/`
const CONTRACT = "contexts/grammars/contract.yaml"
const FAMILIES = ["common", "core", "offset-pop"] as const
const TIERS = new Set(["leaf", "branch", "composite", "frame", "ext"])
/** A component's own files: its markup and its stylesheet. A helper module (`*.ts`) moves no look of its own. */
const COMPONENT_FILE = /\.(tsx|css)$/

type Family = (typeof FAMILIES)[number]

/** One component a lane changed: its family, its name (the component folder, or the file for a family-wide file) and whether a story can name it. */
interface Unit {
    readonly family: Family
    readonly name: string
    readonly named: boolean
}

/** The component a changed file belongs to, or undefined for a file that is no component (a story, a helper, a file outside the Grammar's source). */
export const unitOf = (file: string): Unit | undefined => {
    if (!file.startsWith(GRAMMAR_SRC) || file.startsWith(STORIES) || !COMPONENT_FILE.test(file) || file.endsWith(".stories.tsx")) return undefined
    const parts = file.slice(GRAMMAR_SRC.length).split("/")
    const family = FAMILIES.find((each) => each === parts[0])
    if (family === undefined) return undefined
    // src/<family>/<tier>/<Name>/... is the component <Name>; any other file is the family's own (a shared sheet, a renderer).
    const tier = parts[1]
    const folder = parts[2]
    if (tier !== undefined && TIERS.has(tier) && folder !== undefined && parts.length > 3) return { family, name: folder, named: true }
    return { family, name: (parts.at(-1) ?? "").replace(COMPONENT_FILE, ""), named: false }
}

/**
 * The notices of a lane's changed files: one line per Grammar component changed without a story that names it, and one per component
 * changed with no change to contract.yaml or to its family's context. `read` gives a changed story's text (undefined when deleted).
 */
export const grammarProofNotices = (changed: readonly string[], read: (file: string) => string | undefined): string[] => {
    const units = new Map<string, Unit>()
    for (const file of changed) {
        const unit = unitOf(file)
        if (unit !== undefined) units.set(`${unit.family}/${unit.name}`, unit)
    }
    if (units.size === 0) return []
    const stories = changed.filter((file) => file.startsWith(STORIES) && file.endsWith(".tsx")).map((file) => read(file) ?? "")
    const contract = changed.includes(CONTRACT)
    const notices: string[] = []
    for (const unit of units.values()) {
        const story = unit.named ? stories.some((text) => new RegExp(`\\b${unit.name}\\b`).test(text)) : stories.length > 0
        if (!story) notices.push(`grammar-proof: ${unit.family}/${unit.name} changed without ${unit.named ? `a changed story under ${STORIES} that names ${unit.name}` : `a changed story under ${STORIES}`}`)
        if (!contract && !changed.includes(`contexts/grammars/${unit.family}.md`)) {
            notices.push(`grammar-proof: ${unit.family}/${unit.name} changed without a change to ${CONTRACT} or contexts/grammars/${unit.family}.md`)
        }
    }
    return notices
}

/** The notices of the changed files of a checkout at `root`, the stories read from its working tree. */
export const grammarProofNoticesIn = (root: string, changed: readonly string[]): string[] =>
    grammarProofNotices(changed, (file) => {
        const path = join(root, file)
        return existsSync(path) ? readFileSync(path, "utf8") : undefined
    })

/** The notices a `starci check --json` run printed (its `data.notices`), or none when the output is no such envelope. */
export const noticesOf = (stdout: string): string[] => {
    try {
        const envelope = JSON.parse(stdout) as { readonly data?: { readonly notices?: unknown } }
        const notices = envelope.data?.notices
        return Array.isArray(notices) ? notices.filter((each): each is string => typeof each === "string") : []
    } catch {
        return []
    }
}
