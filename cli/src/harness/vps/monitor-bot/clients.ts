/**
 * The HTTP clients of the monitor bot: Prometheus, Loki, Alertmanager and the read-only Docker API of the socket proxy, all on the
 * monitoring stack's private networks, and nothing else. Each takes the fetch it calls, so the specs pass a fake one; every call has a
 * timeout and an answer that is not the expected shape is an error, never a guess.
 */
import { asArray, asLabels, asNumber, asString, at } from "./json.js"

/** The answer of a fetch, the parts a client reads. */
export interface FetchAnswer {
    readonly ok: boolean
    readonly status: number
    readonly json: () => Promise<unknown>
}

/** The fetch a client calls (the global one in the container, a fake in the specs). */
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<FetchAnswer>

const TIMEOUT_MS = 15_000

const call = async (fetcher: Fetch, url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> => {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${String(response.status)}`)
    return response.json()
}

/** One series of an instant vector: its labels and its value. */
export interface Sample {
    readonly labels: Readonly<Record<string, string>>
    readonly value: number
}

/** One series of a range query: its labels and its values over time. */
export interface Series {
    readonly labels: Readonly<Record<string, string>>
    readonly points: readonly (readonly [number, number])[]
}

/** Prometheus's HTTP API: instant and range queries. */
export interface Prometheus {
    /** The samples of an instant query. */
    readonly query: (expr: string) => Promise<Sample[]>
    /** The single value of an instant query (the first sample), or NaN when it has none. */
    readonly scalar: (expr: string) => Promise<number>
    /** The series of a range query over the last `seconds`, every `step` seconds, ending `now` (epoch seconds). */
    readonly range: (expr: string, seconds: number, step: number, now: number) => Promise<Series[]>
}

const resultOf = (body: unknown, what: string): readonly unknown[] => {
    const result = at(body, "data", "result")
    if (at(body, "status") !== "success" || !Array.isArray(result)) throw new Error(`prometheus answered no ${what}`)
    return result as unknown[]
}

/** A Prometheus client on `base`. */
export const prometheus = (base: string, fetcher: Fetch): Prometheus => {
    const query = async (expr: string): Promise<Sample[]> => resultOf(await call(fetcher, `${base}/api/v1/query?query=${encodeURIComponent(expr)}`), "vector").map((item) => ({ labels: asLabels(at(item, "metric")), value: asNumber(at(item, "value", 1)) }))
    return {
        query,
        scalar: async (expr) => (await query(expr))[0]?.value ?? Number.NaN,
        range: async (expr, seconds, step, now) => {
            const url = `${base}/api/v1/query_range?query=${encodeURIComponent(expr)}&start=${String(now - seconds)}&end=${String(now)}&step=${String(step)}`
            return resultOf(await call(fetcher, url), "matrix").map((item) => ({ labels: asLabels(at(item, "metric")), points: asArray(at(item, "values")).map((point): [number, number] => [asNumber(at(point, 0)), asNumber(at(point, 1))]) }))
        },
    }
}

/** One log line of Loki: its time (ns), its labels and its text. */
export interface LogLine {
    readonly ns: bigint
    readonly labels: Readonly<Record<string, string>>
    readonly line: string
}

/** Loki's HTTP API: a backward range query. */
export interface Loki {
    /** The newest `limit` lines of a LogQL query over the last `seconds`, newest first. */
    readonly lines: (expr: string, seconds: number, limit: number, nowMs: number) => Promise<LogLine[]>
}

/** A Loki client on `base`. */
export const loki = (base: string, fetcher: Fetch): Loki => ({
    lines: async (expr, seconds, limit, nowMs) => {
        const end = BigInt(nowMs) * 1_000_000n
        const start = end - BigInt(seconds) * 1_000_000_000n
        const body = await call(fetcher, `${base}/loki/api/v1/query_range?query=${encodeURIComponent(expr)}&start=${start.toString()}&end=${end.toString()}&limit=${String(limit)}&direction=backward`)
        const result = at(body, "data", "result")
        if (at(body, "status") !== "success" || !Array.isArray(result)) throw new Error("loki answered no streams")
        const lines = (result as unknown[]).flatMap((stream) => asArray(at(stream, "values")).map((value): LogLine => ({ ns: BigInt(/^\d+$/.test(asString(at(value, 0))) ? asString(at(value, 0)) : "0"), labels: asLabels(at(stream, "stream")), line: asString(at(value, 1)) })))
        return lines.sort((left, right) => (left.ns === right.ns ? 0 : left.ns > right.ns ? -1 : 1)).slice(0, limit)
    },
})

/** One alert of Alertmanager's API. */
export interface ManagedAlert {
    readonly labels: Readonly<Record<string, string>>
    readonly annotations: Readonly<Record<string, string>>
    readonly startsAt: string
    readonly state: string
    readonly silencedBy: readonly string[]
}

/** One matcher of a silence. */
export interface Matcher {
    readonly name: string
    readonly value: string
    readonly isRegex: boolean
    readonly isEqual: boolean
}

/** Alertmanager's v2 API: the alerts and a new silence. */
export interface Alertmanager {
    /** The active alerts (firing, silenced or inhibited). */
    readonly alerts: () => Promise<ManagedAlert[]>
    /** Creates a silence; its id. */
    readonly silence: (matchers: readonly Matcher[], startsAt: Date, endsAt: Date, createdBy: string, comment: string) => Promise<string>
}

/** An Alertmanager client on `base`. */
export const alertmanager = (base: string, fetcher: Fetch): Alertmanager => ({
    alerts: async () => {
        const body = await call(fetcher, `${base}/api/v2/alerts?active=true&silenced=true&inhibited=true&unprocessed=false`)
        if (!Array.isArray(body)) throw new Error("alertmanager answered no alert list")
        return (body as unknown[]).map((alert) => ({
            labels: asLabels(at(alert, "labels")),
            annotations: asLabels(at(alert, "annotations")),
            startsAt: asString(at(alert, "startsAt")),
            state: asString(at(alert, "status", "state"), "unknown"),
            silencedBy: asArray(at(alert, "status", "silencedBy")).filter((id): id is string => typeof id === "string"),
        }))
    },
    silence: async (matchers, startsAt, endsAt, createdBy, comment) => {
        const body = await call(fetcher, `${base}/api/v2/silences`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ matchers, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), createdBy, comment }) })
        const id = at(body, "silenceID")
        if (typeof id !== "string") throw new Error("alertmanager made no silence")
        return id
    },
})

/** One swarm service as the bot shows it. */
export interface SwarmService {
    readonly id: string
    readonly name: string
    readonly stack: string
    readonly image: string
    readonly replicas: number | null
    readonly updatedAt: string
    readonly updateState: string | null
}

/** One task of a swarm service: the id of its service and its state. */
export interface SwarmTask {
    readonly serviceId: string
    readonly state: string
}

/** The read-only Docker API through the socket proxy (GET only: it refuses every write). */
export interface Docker {
    /** The services of the given stacks. */
    readonly services: (stacks: readonly string[]) => Promise<SwarmService[]>
    /** The tasks Swarm wants running of the given services (by name). */
    readonly tasks: (serviceNames: readonly string[]) => Promise<SwarmTask[]>
}

/** A Docker client on `base`. */
export const docker = (base: string, fetcher: Fetch): Docker => ({
    services: async (stacks) => {
        // One stack per call: Docker ANDs label filters.
        const all = await Promise.all(
            stacks.map(async (stack) => {
                const body = await call(fetcher, `${base}/services?filters=${encodeURIComponent(JSON.stringify({ label: [`com.docker.stack.namespace=${stack}`] }))}`)
                if (!Array.isArray(body)) throw new Error("docker answered no service list")
                return (body as unknown[]).map((service): SwarmService => {
                    const replicas = at(service, "Spec", "Mode", "Replicated", "Replicas")
                    const state = at(service, "UpdateStatus", "State")
                    return {
                        id: asString(at(service, "ID")),
                        name: asString(at(service, "Spec", "Name")),
                        stack,
                        image: asString(at(service, "Spec", "TaskTemplate", "ContainerSpec", "Image")),
                        replicas: typeof replicas === "number" ? replicas : null,
                        updatedAt: asString(at(service, "UpdatedAt"), asString(at(service, "CreatedAt"))),
                        updateState: typeof state === "string" ? state : null,
                    }
                })
            }),
        )
        return all.flat()
    },
    tasks: async (serviceNames) => {
        if (serviceNames.length === 0) return []
        const filters = encodeURIComponent(JSON.stringify({ service: serviceNames, "desired-state": ["running"] }))
        const body = await call(fetcher, `${base}/tasks?filters=${filters}`)
        if (!Array.isArray(body)) throw new Error("docker answered no task list")
        return (body as unknown[]).map((task) => ({ serviceId: asString(at(task, "ServiceID")), state: asString(at(task, "Status", "State"), "unknown") }))
    },
})
