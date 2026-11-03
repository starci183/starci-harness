/** The events a session listener hears. */
export type SessionEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED"

/** The person of a session as a view reads it. */
export interface SessionPerson {
    readonly id: string
    readonly email: string
    readonly name?: string
}

/** What a view reads: loading until the first answer, then signed in or out. The object changes only when the session does. */
export interface SessionSnapshot<User extends SessionPerson> {
    readonly status: "loading" | "signed-in" | "signed-out"
    readonly user: User | null
}

/** Called on every sign-in, sign-out and token refresh with the id of the person (null when signed out). */
export type SessionListener = (event: SessionEvent, userId: string | null) => void

/** What the store asks of the client that owns it: the facts the first answer of a subscription depends on. */
export interface SessionSource {
    /** Whether the client has answered once (a refresh, a sign-in or a sign-out happened). */
    announced(): boolean
    /** Records that the first answer was given. */
    announce(): void
    /** Whether a token is held now. */
    held(): boolean
    /** The id of the signed-in person, or null. */
    userId(): string | null
    /** Starts (or joins) a refresh. */
    renew(): Promise<unknown>
    /** Whether a refresh is running. */
    refreshing(): boolean
}

/** The snapshot, the listeners and the watchers of one client, shared by every provider's client. */
export interface SessionStore<User extends SessionPerson> {
    /** The current snapshot (stable between changes). */
    getSnapshot: () => SessionSnapshot<User>
    /** The snapshot for server rendering: always loading. */
    getServerSnapshot: () => SessionSnapshot<User>
    /** Publishes the snapshot of a signed-in person; watchers hear it only when status, id, email or name changed. */
    signedIn: (user: User | null) => void
    /** Publishes the signed-out snapshot. */
    signedOut: () => void
    /** Tells every listener an event with the id of the person it concerns. */
    emit: (event: SessionEvent, userId: string | null) => void
    /** Listens to events; the first answer comes from a refresh when the client has not answered yet. Answers the function that stops listening. */
    subscribe: (listener: SessionListener) => () => void
    /** Calls `onChange` when the snapshot changes (the shape `useSyncExternalStore` takes); starts the first refresh when none ran. */
    watch: (onChange: () => void) => () => void
}

/** Creates the session store of a client. `source` is read at call time, never captured. */
export const createSessionStore = <User extends SessionPerson>(source: SessionSource): SessionStore<User> => {
    const loading: SessionSnapshot<User> = { status: "loading", user: null }
    let snapshot: SessionSnapshot<User> = loading
    const listeners = new Set<SessionListener>()
    const watchers = new Set<() => void>()

    const set = (next: SessionSnapshot<User>): void => {
        if (snapshot.status === next.status && snapshot.user?.id === next.user?.id && snapshot.user?.email === next.user?.email && snapshot.user?.name === next.user?.name) return
        snapshot = next
        for (const watcher of watchers) watcher()
    }

    return {
        getSnapshot: () => snapshot,
        getServerSnapshot: () => loading,
        signedIn: (user) => {
            set({ status: "signed-in", user })
        },
        signedOut: () => {
            set({ status: "signed-out", user: null })
        },
        emit: (event, userId) => {
            for (const listener of listeners) listener(event, userId)
        },
        subscribe: (listener) => {
            listeners.add(listener)
            if (source.announced()) {
                listener("INITIAL_SESSION", source.userId())
            } else {
                void source.renew().then(() => {
                    if (!source.announced()) source.announce()
                    if (!source.held()) {
                        set({ status: "signed-out", user: null })
                        listener("INITIAL_SESSION", null)
                    }
                })
            }
            return () => {
                listeners.delete(listener)
            }
        },
        watch: (onChange) => {
            watchers.add(onChange)
            if (!source.announced() && !source.refreshing()) void source.renew().then(() => undefined)
            return () => {
                watchers.delete(onChange)
            }
        },
    }
}

/** One refresh at a time: every caller that arrives while one runs awaits the same promise. */
export interface SingleFlight<T> {
    /** Starts `task` when none runs, else joins the running one; the slot frees itself when the run settles, success or failure. */
    run(): Promise<T>
    /** Whether a run is in progress. */
    running(): boolean
}

/** Guards `task` so that overlapping calls (many requests answered 401 together) share one run. */
export const createSingleFlight = <T>(task: () => Promise<T>): SingleFlight<T> => {
    let inFlight: Promise<T> | undefined
    return {
        run: () => {
            inFlight ??= task().finally(() => {
                inFlight = undefined
            })
            return inFlight
        },
        running: () => inFlight !== undefined,
    }
}
