/**
 * The app's only door to `starci ui`: where the server is, its token, and a typed fetch for every endpoint of
 * `contract.ts`, read by the hooks and the session gate only. In fixtures mode (`?fixtures=1`) every call answers
 * from `fixtures.ts` and nothing leaves the window; `&hold=<reads>` keeps reads loading forever and `&delay=<ms>` answers
 * them late, so a loading layout can be looked at.
 */
import type {
    ActionResult,
    ConfigEntry,
    ConfigSet,
    Decision,
    GoalSet,
    OwnerRequestRow,
    OwnerRequestSet,
    Overview,
    Ruling,
    TaskDetail,
    WorkflowDetail,
} from "@contract"
import { fixtureAction, fixtureConfig, fixtureInbox, fixtureOverview, fixtureOwnerRequests, fixtureTask, fixtureWorkflow } from "./fixtures"

/* ------------------------------------------------------------------ connection */

/** Where the API lives and the bearer token `starci ui` printed. `baseUrl` "" means same origin (the Vite dev proxy). */
export interface Connection {
    readonly baseUrl: string
    readonly token: string
}

const STORAGE_KEY = "starci-harness.connection"
const FIXTURES_KEY = "starci-harness.fixtures"

const readStorage = (storage: Storage | undefined, key: string): string | null => {
    try {
        return storage?.getItem(key) ?? null
    } catch {
        return null
    }
}

const writeStorage = (storage: Storage | undefined, key: string, value: string | null): void => {
    try {
        if (value === null) storage?.removeItem(key)
        else storage?.setItem(key, value)
    } catch {
        // Storage can be blocked; the connection then lives for this window only.
    }
}

const local = (): Storage | undefined => (typeof window === "undefined" ? undefined : window.localStorage)
const session = (): Storage | undefined => (typeof window === "undefined" ? undefined : window.sessionStorage)

/** True inside the Tauri desktop shell. */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

/**
 * Fixtures mode: `?fixtures=1` on the page URL (kept for the session, `?fixtures=0` leaves it) or `VITE_FIXTURES=1` at build.
 */
export const isFixturesMode = (): boolean => {
    if (import.meta.env.VITE_FIXTURES === "1") return true
    if (typeof window === "undefined") return false
    const flag = new URLSearchParams(window.location.search).get("fixtures")
    if (flag === "1") writeStorage(session(), FIXTURES_KEY, "1")
    if (flag === "0") writeStorage(session(), FIXTURES_KEY, null)
    return readStorage(session(), FIXTURES_KEY) === "1"
}

/** Turn fixtures mode on or off for this session (the connect screen's "sample data" door). */
export const setFixturesMode = (on: boolean): void => writeStorage(session(), FIXTURES_KEY, on ? "1" : null)

/**
 * Parse what the owner pastes: the URL `starci ui` prints (`http://127.0.0.1:4317/?token=…`), optionally a bare token
 * when a base URL is already known.
 */
export const parseConnection = (input: string, fallbackBaseUrl = ""): Connection | null => {
    const text = input.trim()
    if (text === "") return null
    try {
        const url = new URL(text)
        if (url.protocol !== "http:" && url.protocol !== "https:") return null
        const token = url.searchParams.get("token") ?? url.hash.match(/token=([^&]+)/)?.[1] ?? ""
        if (token === "") return null
        return { baseUrl: url.origin, token: decodeURIComponent(token) }
    } catch {
        return /^[\w.~+/=-]+$/.test(text) ? { baseUrl: fallbackBaseUrl, token: text } : null
    }
}

/** The connection the browser build can see without asking: `?token=` (and optional `?api=`) or the stored one. */
export const readBrowserConnection = (): Connection | null => {
    if (typeof window === "undefined") return null
    const params = new URLSearchParams(window.location.search)
    const token = params.get("token")
    if (token !== null && token !== "") {
        const connection = { baseUrl: params.get("api") ?? "", token }
        saveConnection(connection)
        return connection
    }
    return loadConnection()
}

export const loadConnection = (): Connection | null => {
    const raw = readStorage(local(), STORAGE_KEY)
    if (raw === null) return null
    try {
        const parsed = JSON.parse(raw) as Partial<Connection>
        return typeof parsed.token === "string" && typeof parsed.baseUrl === "string"
            ? { baseUrl: parsed.baseUrl, token: parsed.token }
            : null
    } catch {
        return null
    }
}

export const saveConnection = (connection: Connection | null): void =>
    writeStorage(local(), STORAGE_KEY, connection === null ? null : JSON.stringify(connection))

/**
 * Tauri: the URL `starci ui` printed, handed to the app at launch (`--url <url>` or `STARCI_UI_URL`), read through the
 * shell's `launch_url` command. Null when it was not given, then the stored connection or the connect screen decides.
 */
export const readLaunchConnection = async (): Promise<Connection | null> => {
    if (!isTauri()) return null
    try {
        const { invoke } = await import("@tauri-apps/api/core")
        const url = await invoke<string | null>("launch_url")
        return url === null ? null : parseConnection(url)
    } catch {
        return null
    }
}

let current: Connection | null = null

/** Point the client at a server; the providers call this before any query runs. */
export const setConnection = (connection: Connection | null): void => {
    current = connection
}

export const getConnection = (): Connection | null => current

/* ------------------------------------------------------------------ fixture timing */

/** The reads a fixtures session can hold or delay, named as in `?hold=`. */
export type FixtureRead = "overview" | "workflow" | "task" | "inbox" | "config" | "ownerRequests"

const FIXTURE_READS: readonly FixtureRead[] = ["overview", "workflow", "task", "inbox", "config", "ownerRequests"]

/**
 * `?hold=1` (or `?hold=overview,task`) keeps those fixture reads pending forever; `?delay=<ms>` answers every fixture read
 * that late. Both are read from the page URL each time, so a reload with other values changes them.
 */
const fixtureTiming = (read: FixtureRead): { readonly hold: boolean; readonly delay: number } => {
    if (typeof window === "undefined") return { hold: false, delay: 0 }
    const params = new URLSearchParams(window.location.search)
    const hold = params.get("hold")
    const held = hold === null ? [] : hold === "1" || hold === "all" ? FIXTURE_READS : hold.split(",")
    const delay = Number(params.get("delay") ?? "0")
    return { hold: held.includes(read), delay: Number.isFinite(delay) && delay > 0 ? delay : 0 }
}

/** Answer a fixture read now, late, or never, as the page URL asks. */
const fixtureRead = <T>(read: FixtureRead, value: () => T): Promise<T> => {
    const { hold, delay } = fixtureTiming(read)
    if (hold) return new Promise<T>(() => undefined)
    if (delay === 0) return Promise.resolve(value())
    return new Promise<T>((resolve) => setTimeout(() => resolve(value()), delay))
}

/* ------------------------------------------------------------------ typed fetch */

export class ApiError extends Error {
    readonly status: number
    readonly code: string | null

    constructor(status: number, code: string | null, message: string) {
        super(message)
        this.name = "ApiError"
        this.status = status
        this.code = code
    }
}

export const apiUrl = (path: string, connection: Connection | null = current): string =>
    `${connection?.baseUrl ?? ""}/api${path}`

const segment = (value: string): string => encodeURIComponent(value)

const request = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    const connection = current
    if (connection === null) throw new ApiError(401, "NO_CONNECTION", "Chưa kết nối tới starci ui")
    const response = await fetch(apiUrl(path, connection), {
        method,
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${connection.token}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const data: unknown = text === "" ? null : JSON.parse(text)
    if (!response.ok) {
        const failure = (data ?? {}) as Partial<ActionResult>
        throw new ApiError(response.status, failure.code ?? null, failure.message ?? `${method} ${path}: ${response.status}`)
    }
    return data as T
}

export type WorkflowAction = "pause" | "resume" | "stop-graceful" | "stop-hard"

/** Every endpoint of the contract, typed. Fixtures mode answers locally. */
export const api = {
    overview: (): Promise<Overview> =>
        isFixturesMode() ? fixtureRead("overview", () => fixtureOverview) : request("GET", "/overview"),
    workflow: (project: string, workflow: string): Promise<WorkflowDetail> =>
        isFixturesMode()
            ? fixtureRead("workflow", () => fixtureWorkflow(project, workflow))
            : request("GET", `/workflows/${segment(project)}/${segment(workflow)}`),
    task: (project: string, task: string): Promise<TaskDetail> =>
        isFixturesMode()
            ? fixtureRead("task", () => fixtureTask(project, task))
            : request("GET", `/tasks/${segment(project)}/${segment(task)}`),
    inbox: (): Promise<Decision[]> =>
        isFixturesMode() ? fixtureRead("inbox", () => [...fixtureInbox]) : request("GET", "/inbox"),
    ruling: (project: string, decision: string, ruling: Ruling): Promise<ActionResult> =>
        isFixturesMode()
            ? Promise.resolve(fixtureAction(`ruling ${decision}`))
            : request("POST", `/inbox/${segment(project)}/${segment(decision)}/ruling`, ruling),
    workflowAction: (project: string, workflow: string, action: WorkflowAction): Promise<ActionResult> =>
        isFixturesMode()
            ? Promise.resolve(fixtureAction(`${action} ${workflow}`))
            : request("POST", `/workflows/${segment(project)}/${segment(workflow)}/${action}`),
    goal: (project: string, workflow: string, goal: GoalSet): Promise<ActionResult> =>
        isFixturesMode()
            ? Promise.resolve(fixtureAction(`goal ${workflow}`))
            : request("POST", `/workflows/${segment(project)}/${segment(workflow)}/goal`, goal),
    ownerRequests: (): Promise<OwnerRequestRow[]> =>
        isFixturesMode() ? fixtureRead("ownerRequests", () => [...fixtureOwnerRequests]) : request("GET", "/owner-requests"),
    askSupervisor: (set: OwnerRequestSet): Promise<ActionResult> =>
        isFixturesMode() ? Promise.resolve(fixtureAction(`supervisor ask ${set.project}`)) : request("POST", "/owner-requests", set),
    config: (): Promise<ConfigEntry[]> =>
        isFixturesMode() ? fixtureRead("config", () => [...fixtureConfig]) : request("GET", "/config"),
    setConfig: (set: ConfigSet): Promise<ActionResult> =>
        isFixturesMode() ? Promise.resolve(fixtureAction(`config set ${set.key}`)) : request("POST", "/config", set),
} as const

/* ------------------------------------------------------------------ writes */

/** One write the owner can make; each goes through a harness verb on the server. */
export type ActionRequest =
    | { readonly kind: "ruling"; readonly project: string; readonly decision: string; readonly ruling: Ruling }
    | { readonly kind: "workflow"; readonly project: string; readonly workflow: string; readonly action: WorkflowAction }
    | { readonly kind: "goal"; readonly project: string; readonly workflow: string; readonly text: string }
    | { readonly kind: "config"; readonly set: ConfigSet }
    | { readonly kind: "ownerRequest"; readonly set: OwnerRequestSet }

export const runAction = (action: ActionRequest): Promise<ActionResult> => {
    switch (action.kind) {
        case "ruling":
            return api.ruling(action.project, action.decision, action.ruling)
        case "workflow":
            return api.workflowAction(action.project, action.workflow, action.action)
        case "goal":
            return api.goal(action.project, action.workflow, { text: action.text })
        case "config":
            return api.setConfig(action.set)
        case "ownerRequest":
            return api.askSupervisor(action.set)
    }
}
