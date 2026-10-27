import { existsSync } from "node:fs"
import { join } from "node:path"
import { readCorpus } from "../core/contexts/search-corpus.js"
import { ruleIdsIn } from "./contract.js"

/** What a cited id stands for: the text of the section or entry that defines it and the harness file holding it. */
export interface ResolvedAnchor {
    readonly text: string
    readonly file: string
    readonly line?: number
}

/**
 * Resolves one cited id (a Choose anchor such as `tabs.choose`, a rule id such as `STATE-6` or `R01`, a DNA or record id, or a
 * `<path>#<anchor>` search id) to its defining text, or undefined when nothing in the contexts defines it.
 *
 * SWAP POINT: lane L5 owns the anchor resolver (cli/src/core/contexts/anchors*, `resolveAnchor(id) -> {text, file} | undefined`).
 * Until it lands, `corpusResolver` below implements this interface over the search corpus the index is built from; when it
 * lands, `anchorResolver` returns L5's resolver and the interim reading below is deleted. Nothing else in the cite check changes.
 */
export type AnchorResolver = (id: string) => ResolvedAnchor | undefined

/** The knowledge page of each component family, whose `## Choose` section a Choose anchor names. */
export const COMPONENT_PAGES = "contexts/ui/components"

/** The heading of the section a Choose anchor points into. */
export const CHOOSE_HEADING = "Choose"

/** A heading or term as a cite spells it: lower case, every run of other characters one hyphen. */
export const anchorSlug = (text: string): string =>
    text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

/** The Choose anchor of a family (`tabs.choose`) and the prefix of its finer anchors (`tabs.choose.<term>`). */
export const chooseAnchor = (family: string): string => `${family}.choose`

/** True when `id` is a Choose anchor of `family`: the family's Choose section or a term inside it. */
export const isChooseOf = (id: string, family: string): boolean => id === chooseAnchor(family) || id.startsWith(`${chooseAnchor(family)}.`)

// Explicit anchors a page may carry: `{#id}` after a heading, or an html anchor `<a id="id">` / `<a name="id">`.
const EXPLICIT = /\{#([A-Za-z0-9][\w.-]*)\}|<a\s+(?:id|name)="([^"]+)"/g

const BOLD = /\*\*([^*]+)\*\*/g

// A family page is lower-case kebab; the folder's README.md never matches.
const FAMILY_PAGE = new RegExp(`^${COMPONENT_PAGES}/([a-z0-9-]+)\\.md$`)

const componentFamily = (path: string): string | undefined => FAMILY_PAGE.exec(path)?.[1]

/** The Choose anchors one chunk of a component page defines: its Choose section, and each sub-heading and bold term under it. */
const chooseAnchorsOf = (path: string, title: string, text: string): string[] => {
    const family = componentFamily(path)
    if (family === undefined) return []
    const heading = /^#{1,6}\s+(.*)$/.exec(text.split("\n")[0] ?? "")?.[1]?.trim() ?? ""
    const own = heading === CHOOSE_HEADING
    const under = title.split(" › ").slice(1).includes(CHOOSE_HEADING)
    if (!own && !under) return []
    const terms = [...text.matchAll(BOLD)].map((found) => anchorSlug(found[1] ?? ""))
    return [...(own ? [chooseAnchor(family)] : [`${chooseAnchor(family)}.${anchorSlug(heading)}`]), ...terms.filter((term) => term !== "").map((term) => `${chooseAnchor(family)}.${term}`)]
}

const cache = new Map<string, ReadonlyMap<string, ResolvedAnchor>>()

/**
 * The resolver over the search corpus under `root` (the harness checkout): every chunk's anchor and aliases (core/contexts
 * anchors.ts owns how a chunk is anchored), every id a chunk names as the rules-cited trace reads it (a heading token or a yaml `id:`), explicit
 * `{#id}` and `<a id>` anchors, and the Choose anchors of contexts/ui/components/<family>.md (`<family>.choose`, plus
 * `<family>.choose.<term>` for each sub-heading and bold term of that section). The first definition of an id wins.
 */
export const corpusResolver = (root: string): AnchorResolver => {
    let ids = cache.get(root)
    if (ids === undefined) {
        const built = new Map<string, ResolvedAnchor>()
        const define = (id: string, anchor: ResolvedAnchor): void => {
            if (id !== "" && !built.has(id)) built.set(id, anchor)
        }
        const corpus = existsSync(join(root, "contexts")) ? readCorpus(root).chunks : []
        for (const chunk of corpus) {
            const anchor = { text: chunk.text, file: chunk.path, line: chunk.line }
            define(chunk.anchor, anchor)
            for (const alias of chunk.aliases) define(alias, anchor)
            for (const id of ruleIdsIn(chunk.text)) define(id, anchor)
            for (const found of chunk.text.matchAll(EXPLICIT)) define(found[1] ?? found[2] ?? "", anchor)
            for (const id of chooseAnchorsOf(chunk.path, chunk.title, chunk.text)) define(id, anchor)
        }
        ids = built
        cache.set(root, ids)
    }
    const known = ids
    return (id) => known.get(id.trim())
}

/** The resolver the cite check uses for the harness checkout at `root` (see the swap point on AnchorResolver). */
export const anchorResolver = (root: string): AnchorResolver => corpusResolver(root)
