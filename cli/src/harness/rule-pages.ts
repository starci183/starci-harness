import { existsSync, globSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { presenceIn, readSlotCatalog, topicsOfSlot } from "../core/contexts/anatomy-render.js"
import type { AnatomyEdition, Slot, SlotCatalog } from "../core/contexts/anatomy-render.js"
import { isRuleId } from "./contract.js"

/**
 * The rule pages of a task's paths: the contexts pages that own a rule governing a path the task may write. The catalog is
 * hfs/slots.yaml (each slot's path, relative to its side) and the `slots` front matter of contexts/code/{be,fe}/*.md (the
 * slots whose code a page's rules govern), the same reading the anatomy renders; nothing here names a path or a page.
 */

/** Where the slot catalog lives in the harness checkout. */
const CONTEXTS = "contexts"
const CODE_PAGES = `${CONTEXTS}/code`

/** The sides of an app repository: a path under `be/` or `fe/` is matched against that side's slots, any other against the app root's. */
const SIDES = new Set(["be", "fe"])

type Segment = "**" | RegExp

/** One brace-free variant of a slot path: its segments, whether it owns a folder, its specificity, and its variable names in order. */
interface Variant {
    readonly slot: Slot
    readonly segments: readonly Segment[]
    readonly names: readonly (readonly string[])[]
    readonly dir: boolean
    readonly score: number
}

/** Expands the first `{a,b}` group of a slot path, recursively: `src/{api/,jobs/}<f>/` is `src/api/<f>/` and `src/jobs/<f>/`. */
const braceVariants = (path: string): string[] => {
    const open = path.indexOf("{")
    if (open < 0) return [path]
    let depth = 0
    let close = -1
    for (let index = open; index < path.length && close < 0; index += 1) {
        if (path[index] === "{") depth += 1
        if (path[index] === "}") depth -= 1
        if (depth === 0) close = index
    }
    if (close < 0) return [path]
    const options: string[] = []
    let current = ""
    depth = 0
    for (const char of path.slice(open + 1, close)) {
        if (char === "{") depth += 1
        if (char === "}") depth -= 1
        if (char === "," && depth === 0) {
            options.push(current)
            current = ""
        } else current += char
    }
    options.push(current)
    const head = path.slice(0, open)
    const tail = path.slice(close + 1)
    return options.flatMap((option) => braceVariants(head + option + tail))
}

const escapeRegex = (char: string): string => (/[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char)

/** One pattern segment as a regular expression: `<name>` captures one segment, `*` any run within it, `?` one character. */
const segmentOf = (segment: string): { readonly regex: Segment; readonly names: string[] } => {
    if (segment === "**") return { regex: "**", names: [] }
    const names: string[] = []
    const source = segment.replace(/<([A-Za-z][\w-]*)>|\*|\?|./g, (token: string, name: string | undefined) => {
        if (name !== undefined) {
            names.push(name)
            return "([^/]+?)"
        }
        if (token === "*") return "[^/]*"
        return token === "?" ? "[^/]" : escapeRegex(token)
    })
    return { regex: new RegExp(`^${source}$`), names }
}

/** The specificity of a segment as HFS weighs it: literal 4, literal with a variable 3, a bare variable 2, a wildcard 1, `**` 0. */
const weightOf = (segment: string): number => {
    if (segment === "**") return 0
    if (/[*?]/.test(segment)) return 1
    if (/^<[^>]+>$/.test(segment)) return 2
    return segment.includes("<") ? 3 : 4
}

const variantsOf = (slot: Slot): Variant[] =>
    braceVariants(slot.path).map((pattern) => {
        const dir = pattern.endsWith("/")
        const parts = (dir ? pattern.slice(0, -1) : pattern).split("/")
        const compiled = parts.map(segmentOf)
        return { slot, segments: compiled.map((part) => part.regex), names: compiled.map((part) => part.names), dir, score: parts.reduce((sum, part) => sum + weightOf(part), 0) }
    })

/** How a task path meets a slot: the path lies inside the slot (`inside`), or the slot lies below the path, a folder (`below`). */
interface Meeting {
    readonly kind: "inside" | "below"
    readonly bindings: Readonly<Record<string, string>>
}

/** Matches the path's segments against a variant from `i` and `j`; `inside` wins over `below` when `**` allows both. */
const meet = (path: readonly string[], variant: Variant, i: number, j: number, bindings: Record<string, string>): Meeting | undefined => {
    if (j === variant.segments.length) return i === path.length || variant.dir ? { kind: "inside", bindings } : undefined
    if (i === path.length) return { kind: "below", bindings }
    const segment = variant.segments[j]
    const part = path[i]
    if (segment === undefined || part === undefined) return undefined
    if (segment === "**") return meet(path, variant, i, j + 1, bindings) ?? meet(path, variant, i + 1, j, bindings)
    const found = segment.exec(part)
    if (found === null) return undefined
    const bound = { ...bindings }
    for (const [index, name] of (variant.names[j] ?? []).entries()) bound[name] = found[index + 1] ?? ""
    return meet(path, variant, i + 1, j + 1, bound)
}

/** True when the slot exists in the edition on the side: not outside its editions, not forbidden, and tracked. */
const exists = (slot: Slot, side: string, edition: string | undefined): boolean => {
    if (slot.tracked !== "tracked") return false
    if (edition !== "lite" && edition !== "full") return slot.presence !== "forbidden"
    const presence = presenceIn(slot, edition satisfies AnatomyEdition, side as "app" | "be" | "fe")
    return presence !== undefined && presence !== "forbidden"
}

/**
 * The slots one repository path governs: the most specific slots it lies inside (HFS gives a path exactly one; equal
 * specificity keeps each), and every slot that lies below it when it is a folder. An app-kind slot (`apps/<app>/src/` of
 * kind cli) is kept only when the app's folder names that kind or names no kind of the side, since the app's hfs.json is
 * not read here.
 */
const slotsOfPath = (path: string, catalog: SlotCatalog, edition: string | undefined): { readonly side: string; readonly slots: Slot[] } => {
    const parts = path.split("/").filter((part) => part !== "" && part !== ".")
    const first = parts[0] ?? ""
    const side = SIDES.has(first) ? first : "app"
    const rest = side === "app" ? parts : parts.slice(1)
    const kinds = catalog.appKinds[side] ?? []
    const inside: { readonly slot: Slot; readonly score: number }[] = []
    const below: Slot[] = []
    for (const slot of catalog.slots) {
        if (!slot.profiles.includes(side as "app" | "be" | "fe") || !exists(slot, side, edition)) continue
        for (const variant of variantsOf(slot)) {
            const met = meet(rest, variant, 0, 0, {})
            if (met === undefined) continue
            const app = met.bindings.app
            if (slot.appKind !== undefined && app !== undefined && kinds.includes(app) && app !== slot.appKind) continue
            if (met.kind === "inside") inside.push({ slot, score: variant.score })
            else below.push(slot)
        }
    }
    const best = Math.max(...inside.map((hit) => hit.score))
    const slots = [...inside.filter((hit) => hit.score === best).map((hit) => hit.slot), ...below]
    return { side, slots: [...new Set(slots)] }
}

const catalogs = new Map<string, SlotCatalog | undefined>()

/** The slot catalog of the harness checkout at `harnessRoot`, read once; undefined when the checkout carries none. */
const catalogOf = (harnessRoot: string): SlotCatalog | undefined => {
    if (catalogs.has(harnessRoot)) return catalogs.get(harnessRoot)
    const knowledge = join(harnessRoot, CONTEXTS)
    const catalog = existsSync(join(knowledge, "hfs", "slots.yaml")) && existsSync(join(knowledge, "code")) ? readSlotCatalog(knowledge) : undefined
    catalogs.set(harnessRoot, catalog)
    return catalog
}

/**
 * The rule pages of `allowPaths` (harness-relative, `contexts/code/be/cli.md`): every page of the side whose front matter
 * declares a slot a path governs. A page whose `slots` is empty holds cross-cutting rules and is never pulled by a path.
 */
export const rulePagesOf = (harnessRoot: string, allowPaths: readonly string[], edition?: string): string[] => {
    const catalog = catalogOf(harnessRoot)
    if (catalog === undefined) return []
    const pages = new Set<string>()
    for (const path of allowPaths) {
        const { side, slots } = slotsOfPath(path, catalog, edition)
        for (const slot of slots) for (const topic of topicsOfSlot(slot, side, catalog)) pages.add(posix.join(CODE_PAGES, topic))
    }
    return [...pages].sort((left, right) => Number(left > right) - Number(left < right))
}

const owners = new Map<string, ReadonlyMap<string, string>>()

/** The page each rule id is defined on: the first contexts page with a heading that opens with the id (`## BE-CLI-2 ...`). */
const ownersOf = (harnessRoot: string): ReadonlyMap<string, string> => {
    const known = owners.get(harnessRoot)
    if (known !== undefined) return known
    const found = new Map<string, string>()
    const files = existsSync(join(harnessRoot, CONTEXTS)) ? globSync(`${CONTEXTS}/**/*.md`, { cwd: harnessRoot }).map((file) => file.replaceAll("\\", "/")) : []
    for (const file of files.sort((left, right) => Number(left > right) - Number(left < right))) {
        for (const line of readFileSync(join(harnessRoot, file), "utf8").split(/\r?\n/)) {
            const first = /^ {0,3}#{1,6}\s+([A-Za-z0-9._-]+)/.exec(line)?.[1]
            if (first !== undefined && isRuleId(first) && !found.has(first)) found.set(first, file)
        }
    }
    owners.set(harnessRoot, found)
    return found
}

/** The contexts page that owns rule `id` (harness-relative), or undefined when no page defines it. */
export const ruleOwnerOf = (harnessRoot: string, id: string): string | undefined => ownersOf(harnessRoot).get(id)
