// The gallery as data: the screens of gallery/pages, the design.json of the canvas and the frames of its fragments joined into one tree of areas and screens, each
// with its status (the dot), its states (sibling screens of one page) and its counts. Pure: nothing here touches the disk (load.ts reads it, the app draws it).
import { flowList, linkList, noteToMarkdown, parseExplain, SHOT_WIDTHS } from "./explain.ts"
import type { Explain, Flow, Link, Width } from "./explain.ts"

/** The status of a screen, from design.json and the shots (PROJECT-GALLERY-6): the colour of its dot. */
export type Status = "matches" | "differs" | "stale" | "notBuilt" | "none"

/** The state suffixes of a screen id, in the order of the state table of PROJECT-GALLERY-6 item 2. */
export const STATE_KINDS = ["detail", "empty", "first-visit", "loading", "error", "no-match", "editing"] as const
export type StateKind = (typeof STATE_KINDS)[number]

export interface RawFrame {
    /** The widths the fragment draws. */
    readonly widths: readonly ("1440" | "390")[]
    /** The pixel height of each drawn width, when the frame states one. */
    readonly heights: Partial<Record<"1440" | "390", number>>
    readonly title?: string
    readonly route?: string
    /** The note of the fragment, as explain.md text. */
    readonly noteMarkdown?: string
}

export interface RawScreen {
    /** The explain.md text, absent when the folder has none. */
    readonly explain?: string
    /** The parsed links.json. */
    readonly links?: unknown
    /** The widths a PNG exists for in the work tree. */
    readonly shots: readonly Width[]
    /** Whether the PNGs in the work tree hold the sha256 design.json records; absent when nothing was compared. */
    readonly shotsMatchRecord?: boolean
}

export interface RawGallery {
    readonly screens: Readonly<Record<string, RawScreen>>
    readonly flows?: unknown
    readonly design?: unknown
    readonly frames: Readonly<Record<string, RawFrame>>
}

export interface Screen {
    readonly id: string
    readonly area: string
    readonly name: string
    readonly title: string
    readonly route: string | null
    readonly status: Status
    /** The designed status word of design.json, when the screen has an entry. */
    readonly designStatus: string | null
    readonly board: string | null
    readonly shots: readonly Width[]
    readonly frame: RawFrame | null
    readonly explain: Explain | null
    readonly links: Link[]
    /** The page this screen is a state of (its base id) and the state; `base` for the page's own screen. */
    readonly page: string
    readonly state: StateKind | "base"
    readonly problems: number
}

export interface Area {
    readonly area: string
    readonly screens: Screen[]
}

export interface Counts {
    readonly total: number
    readonly matches: number
    readonly differs: number
    readonly stale: number
    readonly notBuilt: number
    readonly hidden: number
}

export interface Model {
    readonly areas: Area[]
    readonly screens: Record<string, Screen>
    readonly flows: Flow[]
    readonly counts: Counts
    /** Every id of the screens of one page, its own screen first and then its states in table order. */
    readonly pages: Record<string, string[]>
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The base id and the state of a screen id: the longest `-<state>` suffix of the table is the state, anything else is a page's own screen. */
export function splitState(id: string): { page: string; state: StateKind | "base" } {
    const slash = id.indexOf("/")
    const area = id.slice(0, slash + 1)
    const name = id.slice(slash + 1)
    let best: StateKind | null = null
    for (const kind of STATE_KINDS) if (name.endsWith(`-${kind}`) && name.length > kind.length + 1 && (best === null || kind.length > best.length)) best = kind
    return best === null ? { page: id, state: "base" } : { page: `${area}${name.slice(0, name.length - best.length - 1)}`, state: best }
}

/**
 * The status of a screen: its design.json entry says drafted or approved (no code yet: not built), built (coded, not yet compared) or matches. A built or matching
 * screen whose PNGs are not the sha256 the manifest records, and a drafted or approved one that still records shots, is stale (PROJECT-GALLERY-6 item 6).
 */
export function statusOf(entry: unknown, shotsMatchRecord: boolean | undefined): Status {
    if (!plain(entry)) return "none"
    const status = entry.status
    const recorded = plain(entry.shots) && Object.keys(entry.shots).length > 0
    if (status === "matches") return shotsMatchRecord === false ? "stale" : "matches"
    if (status === "built") return shotsMatchRecord === false ? "stale" : "differs"
    if (status === "drafted" || status === "approved") return recorded ? "stale" : "notBuilt"
    return "none"
}

/** A value that is present and not empty, else undefined: an empty front matter field falls through to the next source. */
const nonEmpty = (value: string | undefined): string | undefined => (value === undefined || value === "" ? undefined : value)

const titleOf = (id: string, explain: Explain | null, frame: RawFrame | null): string => nonEmpty(explain?.meta.title) ?? nonEmpty(frame?.title) ?? id.slice(id.indexOf("/") + 1)

export function buildModel(raw: RawGallery): Model {
    const designPages = plain(raw.design) && plain(raw.design.pages) ? raw.design.pages : {}
    const ids = new Set<string>([...Object.keys(raw.screens), ...Object.keys(designPages), ...Object.keys(raw.frames)])
    const screens: Record<string, Screen> = {}
    let hidden = 0
    for (const id of [...ids].sort()) {
        const slash = id.indexOf("/")
        if (slash < 1) continue
        const rawScreen = raw.screens[id]
        const frame = raw.frames[id] ?? null
        const text = rawScreen?.explain ?? frame?.noteMarkdown ?? null
        const entry = designPages[id]
        if (text === null && !plain(entry)) {
            hidden++
            continue
        }
        const explain = text === null ? null : parseExplain(text)
        const { page, state } = splitState(id)
        screens[id] = {
            id,
            area: id.slice(0, slash),
            name: id.slice(slash + 1),
            title: titleOf(id, explain, frame),
            route: nonEmpty(explain?.meta.route) ?? nonEmpty(frame?.route) ?? null,
            status: statusOf(entry, rawScreen?.shotsMatchRecord),
            designStatus: plain(entry) && typeof entry.status === "string" ? entry.status : null,
            board: plain(entry) && typeof entry.board === "string" ? entry.board : null,
            shots: rawScreen?.shots ?? [],
            frame,
            explain,
            links: linkList(rawScreen?.links),
            page,
            state,
            problems: explain === null ? 0 : explain.regions.filter((region) => region.problems.length > 0).length + (explain.regions.length === 0 ? 1 : 0),
        }
    }
    const byArea = new Map<string, Screen[]>()
    for (const screen of Object.values(screens)) byArea.set(screen.area, [...(byArea.get(screen.area) ?? []), screen])
    const areas = [...byArea.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([area, list]) => ({ area, screens: list }))
    const pages: Record<string, string[]> = {}
    for (const screen of Object.values(screens)) (pages[screen.page] ??= []).push(screen.id)
    const order = (id: string): number => {
        const state = screens[id]?.state ?? "base"
        return state === "base" ? -1 : STATE_KINDS.indexOf(state)
    }
    for (const list of Object.values(pages)) list.sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    const all = Object.values(screens)
    const count = (status: Status): number => all.filter((screen) => screen.status === status).length
    return {
        areas,
        screens,
        flows: flowList(raw.flows),
        pages,
        counts: { total: all.length, matches: count("matches"), differs: count("differs"), stale: count("stale"), notBuilt: count("notBuilt"), hidden },
    }
}

/** The route of a screen as a path on the dev app, or null when it is dynamic (`[id]`, `:id`, `*`) and so names no one page. */
export function devPath(route: string | null): string | null {
    if (route === null || !route.startsWith("/") || /[[\]:*]/u.test(route)) return null
    return route
}

export { SHOT_WIDTHS, noteToMarkdown }
