import type { NotificationClient, OutboxEvent, Subscription, SubscriptionHandlers } from "./contracts.ts"
import { OutboxError, OutboxErrorCode } from "./errors.ts"
import { run } from "./sql.ts"
import type { Queryable, Row } from "./sql.ts"
import type { Statements } from "./statements.ts"
import type { ScopeType } from "./tables.ts"

/** Events one read of a scope takes at most; the read goes on until a page comes back short. */
const PAGE = 500
const MAX_RECONNECT_MS = 30_000
const DIGITS = /^\d{1,19}$/u

/** What the hub needs of its outbox. */
export interface HubDeps {
    /** Where the events are read: the pool, never the listening connection. */
    readonly database: Queryable
    readonly sql: Statements
    readonly channel: string
    readonly scopeType: ScopeType
    readonly listener: () => Promise<NotificationClient>
    readonly reconnectMs: number
    readonly report: (event: string, cause: unknown, fields?: Readonly<Record<string, string>>) => void
}

interface Subscriber {
    readonly topics: ReadonlySet<string>
    readonly handlers: SubscriptionHandlers
    /** The last seq it was handed: nothing at or below it is handed again. */
    last: bigint
    /** Joined: its replay is done and live events reach it. */
    live: boolean
    gone: boolean
}

interface ScopeState {
    readonly scope: string
    /** The last seq of the scope this process has read; set by the first join, under the scope's chain. */
    cursor: bigint | undefined
    readonly subscribers: Set<Subscriber>
    /** Every read of the scope runs on this chain, one at a time, so a join and a wake never interleave. */
    chain: Promise<void>
    /** A read is queued and has not started: another wake adds nothing. */
    pending: boolean
}

const eventOf = (row: Row): OutboxEvent => ({
    seq: String(row.seq),
    scope: String(row.scope),
    topic: String(row.topic),
    type: String(row.type),
    data: row.data,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
})

/** The seq a subscription resumes after: digits only, anything else (a missing or forged header) starts live. */
export const resumePoint = (lastEventId: string | undefined): bigint | undefined =>
    lastEventId !== undefined && DIGITS.test(lastEventId) ? BigInt(lastEventId) : undefined

/** Refuses a subscription with no scope or no topic, before any header is written. */
export const checkSubscription = (subscription: Subscription): void => {
    const scope: unknown = subscription.scope
    const topics: readonly unknown[] = Array.isArray(subscription.topics) ? subscription.topics : []
    if (typeof scope !== "string" || scope === "" || topics.length === 0 || topics.some((topic) => typeof topic !== "string" || topic === "")) {
        throw new OutboxError({ code: OutboxErrorCode.SubscriptionInvalid, params: { scope: String(scope), topics: topics.map(String).join(",") } })
    }
}

/**
 * The events of one process: ONE dedicated connection LISTENs on the outbox's channel and every subscriber of the process hangs off it.
 * A notification names a scope; the scope's events after the last one read are read once and handed to each of its subscribers whose
 * topics take them. No subscriber polls the database. A join reads the scope's head under the scope's chain, after the LISTEN is up, then
 * replays what it missed up to that head, so nothing falls between the replay and the live events, and nothing is handed twice.
 */
export class EventHub {
    private readonly deps: HubDeps
    private readonly scopes = new Map<string, ScopeState>()
    private client: NotificationClient | undefined
    private connecting: Promise<void> | undefined
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined
    private backoffMs: number
    private closed = false

    constructor(deps: HubDeps) {
        this.deps = deps
        this.backoffMs = deps.reconnectMs
    }

    /** How many subscribers are joined now, across scopes. */
    get size(): number {
        let total = 0
        for (const state of this.scopes.values()) total += state.subscribers.size
        return total
    }

    /**
     * Subscribes to one scope's topics: when `lastEventId` is a seq, the events after it are handed first, in order, then the live ones.
     * Answers the unsubscribe once the subscriber is joined.
     */
    async subscribe(subscription: Subscription, handlers: SubscriptionHandlers): Promise<() => void> {
        checkSubscription(subscription)
        await this.listening()
        if (this.closed) throw new OutboxError({ code: OutboxErrorCode.StreamUnconfigured, params: { reason: "closed" } })
        const scope = this.scopeKey(subscription.scope)
        const state = this.stateOf(scope)
        const subscriber: Subscriber = { topics: new Set(subscription.topics), handlers, last: 0n, live: false, gone: false }
        state.subscribers.add(subscriber)
        const leave = (): void => {
            subscriber.gone = true
            state.subscribers.delete(subscriber)
            if (state.subscribers.size === 0 && this.scopes.get(scope) === state) this.scopes.delete(scope)
        }
        try {
            await this.onChain(state, () => this.join(state, subscriber, resumePoint(subscription.lastEventId)))
        } catch (cause) {
            leave()
            throw cause
        }
        return leave
    }

    /** Ends every subscription and the listening connection; a later subscribe is refused. */
    async close(): Promise<void> {
        this.closed = true
        if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
        const states = [...this.scopes.values()]
        this.scopes.clear()
        for (const state of states) {
            for (const subscriber of state.subscribers) {
                subscriber.gone = true
                this.closeOne(subscriber)
            }
            state.subscribers.clear()
        }
        await this.connecting?.catch(() => undefined)
        const client = this.client
        this.client = undefined
        if (client !== undefined) await client.end().catch((cause: unknown) => {
            this.deps.report("events-listener-end", cause)
        })
    }

    private closeOne(subscriber: Subscriber, cause?: unknown): void {
        try {
            subscriber.handlers.onClose?.(cause)
        } catch (failure) {
            this.deps.report("events-close", failure)
        }
    }

    private scopeKey(scope: string): string {
        return this.deps.scopeType === "uuid" ? scope.toLowerCase() : scope
    }

    private stateOf(scope: string): ScopeState {
        const known = this.scopes.get(scope)
        if (known !== undefined) return known
        const state: ScopeState = { scope, cursor: undefined, subscribers: new Set(), chain: Promise.resolve(), pending: false }
        this.scopes.set(scope, state)
        return state
    }

    private onChain(state: ScopeState, work: () => Promise<void>): Promise<void> {
        const next = state.chain.then(work)
        state.chain = next.catch((cause: unknown) => {
            this.deps.report("events-read", cause, { scope: state.scope })
        })
        return next
    }

    /** The join of one subscriber: the scope's head (once per scope state), the replay after its resume point, then live. */
    private async join(state: ScopeState, subscriber: Subscriber, after: bigint | undefined): Promise<void> {
        if (state.cursor === undefined) {
            const seq = (await run(this.deps.database, this.deps.sql.scopeHead, [state.scope]))[0]?.seq
            state.cursor = BigInt(typeof seq === "string" ? seq : "0")
        }
        const head = state.cursor
        if (after === undefined || after >= head) {
            subscriber.last = after ?? head
            subscriber.live = true
            return
        }
        let from = after
        for (;;) {
            const rows = await run(this.deps.database, this.deps.sql.replay, [state.scope, [...subscriber.topics], from.toString(), head.toString(), PAGE])
            for (const row of rows) {
                const event = eventOf(row)
                from = BigInt(event.seq)
                this.hand(state, subscriber, event, from)
            }
            if (rows.length < PAGE || subscriber.gone) break
        }
        if (subscriber.last < head) subscriber.last = head
        subscriber.live = true
    }

    /** A notification of the scope: one read is queued on its chain, unless one is queued already. */
    private wake(scope: string): void {
        const state = this.scopes.get(scope)
        if (state === undefined || state.pending) return
        state.pending = true
        void this.onChain(state, async () => {
            state.pending = false
            await this.pull(state)
        }).catch(() => undefined)
    }

    /** Reads the scope's events after its cursor and hands each to the live subscribers whose topics take it. */
    private async pull(state: ScopeState): Promise<void> {
        for (;;) {
            if (state.cursor === undefined || state.subscribers.size === 0) return
            const rows = await run(this.deps.database, this.deps.sql.eventsAfter, [state.scope, state.cursor.toString(), PAGE])
            for (const row of rows) {
                const event = eventOf(row)
                const seq = BigInt(event.seq)
                state.cursor = seq
                for (const subscriber of state.subscribers) if (subscriber.live && subscriber.topics.has(event.topic)) this.hand(state, subscriber, event, seq)
            }
            if (rows.length < PAGE) return
        }
    }

    private hand(state: ScopeState, subscriber: Subscriber, event: OutboxEvent, seq: bigint): void {
        if (subscriber.gone || seq <= subscriber.last) return
        subscriber.last = seq
        try {
            subscriber.handlers.onEvent(event)
        } catch (cause) {
            this.deps.report("events-deliver", cause, { scope: state.scope })
            subscriber.gone = true
            state.subscribers.delete(subscriber)
            this.closeOne(subscriber, cause)
        }
    }

    /* ------------------------------------------------------------------ the listening connection ------------------------------- */

    private async listening(): Promise<void> {
        if (this.closed) throw new OutboxError({ code: OutboxErrorCode.StreamUnconfigured, params: { reason: "closed" } })
        if (this.client !== undefined) return
        this.connecting ??= this.connect().finally(() => {
            this.connecting = undefined
        })
        await this.connecting
    }

    private async connect(): Promise<void> {
        const client = await this.deps.listener()
        let broken = false
        const lost = (cause: unknown): void => {
            if (broken) return
            broken = true
            if (this.client === client) this.client = undefined
            void client.end().catch(() => undefined)
            if (this.closed) return
            this.deps.report("events-listener", cause)
            this.reconnectLater()
        }
        client.on("notification", (message) => {
            if (message.channel === this.deps.channel && message.payload !== undefined) this.wake(message.payload)
        })
        client.on("error", lost)
        client.on("end", () => {
            lost(new Error("the listening connection ended"))
        })
        try {
            await client.query(`LISTEN "${this.deps.channel}"`)
        } catch (cause) {
            broken = true
            await client.end().catch(() => undefined)
            throw cause
        }
        if (this.closed) {
            broken = true
            await client.end().catch(() => undefined)
            return
        }
        this.client = client
        this.backoffMs = this.deps.reconnectMs
    }

    /** Opens the listening connection again after a doubling wait, then reads every followed scope, which catches up what the gap missed. */
    private reconnectLater(): void {
        if (this.reconnectTimer !== undefined) return
        const wait = this.backoffMs
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_RECONNECT_MS)
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined
            if (this.closed) return
            this.listening()
                .then(() => {
                    for (const scope of this.scopes.keys()) this.wake(scope)
                })
                .catch((cause: unknown) => {
                    this.deps.report("events-listener", cause)
                    this.reconnectLater()
                })
        }, wait)
        this.reconnectTimer.unref()
    }
}
