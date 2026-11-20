// The design board of an app (contexts/project/gallery.md PROJECT-GALLERY-9): `gallery/board/board.yaml` lists every screen of the app as a section, with its route, its
// named states and its "cần API" marks; each section is drawn by its own module, `gallery/board/<area>/<screen>.tsx`, composed only of Grammar components. This reader is
// lenient: it keeps every section it can read and names what it skipped, and the gate (R395, HFS_APP_GALLERY_BOARD_*) judges the record strictly.

/** The board folder inside the gallery root, and its record. */
export const BOARD_DIR = "board"
export const BOARD_FILE = "board.yaml"
/** The state every section draws first: the screen at rest. */
export const DEFAULT_STATE = "default"
/** The two widths every state is drawn at. */
export const BOARD_WIDTHS = ["1440", "390"] as const
export type BoardWidth = (typeof BOARD_WIDTHS)[number]

export interface BoardSection {
    /** The gallery screen id `<area>/<screen>` the section becomes. */
    readonly id: string
    readonly area: string
    readonly title: string
    /** The route the section becomes. */
    readonly route: string
    /** True while the route is not coded yet. */
    readonly planned: boolean
    /** The named states, `default` first. */
    readonly states: readonly string[]
    /** The "cần API" operations the section needs. */
    readonly needsApi: readonly string[]
    /** True when `gallery/board/<id>.tsx` exists. */
    readonly hasModule: boolean
}

export interface Board {
    readonly revision: number | null
    readonly approvedAt: string | null
    /** App-root relative stylesheets: the app's theme tokens, loaded after the Grammar's stylesheet. */
    readonly tokens: readonly string[]
    readonly sections: readonly BoardSection[]
    /** What the reader skipped, for the board's header; the gate reports the same faults. */
    readonly problems: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [])
const SCREEN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** The board of a parsed board.yaml value; `hasModule` says whether a section's module exists. */
export function readBoard(doc: unknown, hasModule: (id: string) => boolean): Board {
    if (!isRecord(doc)) return { revision: null, approvedAt: null, tokens: [], sections: [], problems: ["board.yaml is not a map"] }
    const problems: string[] = []
    const sections: BoardSection[] = []
    const seen = new Set<string>()
    for (const [index, value] of (Array.isArray(doc.sections) ? doc.sections : []).entries()) {
        const id = isRecord(value) && typeof value.id === "string" ? value.id.trim() : ""
        if (!isRecord(value) || !SCREEN_ID.test(id) || seen.has(id)) {
            problems.push(`sections[${String(index)}]: no gallery screen id <area>/<screen>, or one named twice`)
            continue
        }
        seen.add(id)
        const states = texts(value.states)
        sections.push({
            id,
            area: id.split("/")[0] ?? "",
            title: typeof value.title === "string" && value.title.trim() !== "" ? value.title.trim() : id,
            route: typeof value.route === "string" ? value.route.trim() : "",
            planned: value.planned === true,
            states: states.length === 0 ? [DEFAULT_STATE] : states,
            needsApi: texts(value.needsApi),
            hasModule: hasModule(id),
        })
    }
    const revision = typeof doc.revision === "number" && Number.isInteger(doc.revision) ? doc.revision : null
    const approvedAt = typeof doc.approvedAt === "string" ? doc.approvedAt : null
    return { revision, approvedAt, tokens: texts(doc.tokens), sections, problems }
}

/** The address of one frame of the board: the section, its state and the width the frame is drawn at. */
export const boardFrameUrl = (id: string, state: string, width: BoardWidth): string => `/__board/frame.html?${new URLSearchParams({ s: id, state, w: width }).toString()}`

/** The message a frame posts to the board with its content height, so the board sizes the frame to the screen it draws. */
export interface BoardFrameHeight {
    readonly kind: "starci-board-height"
    readonly key: string
    readonly height: number
}

/** The key of one frame, the same on both sides of the message. */
export const boardFrameKey = (id: string, state: string, width: string): string => `${id}|${state}|${width}`
