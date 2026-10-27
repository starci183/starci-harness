import type { RouterEvents } from "./types.ts"

type Handler<E extends keyof RouterEvents> = (payload: RouterEvents[E]) => void

/** A typed event fan-out. A handler that throws is isolated: observing a call never breaks it. */
export class Emitter {
    readonly #handlers = new Map<keyof RouterEvents, Set<(payload: never) => void>>()

    /** Subscribes and returns the unsubscribe function. */
    on<E extends keyof RouterEvents>(event: E, handler: Handler<E>): () => void {
        let set = this.#handlers.get(event)
        if (set === undefined) {
            set = new Set()
            this.#handlers.set(event, set)
        }
        set.add(handler)
        return () => {
            set.delete(handler)
        }
    }

    /** Delivers one event to every handler of its name. */
    emit<E extends keyof RouterEvents>(event: E, payload: RouterEvents[E]): void {
        const set = this.#handlers.get(event)
        if (set === undefined) return
        for (const handler of set) {
            const typed = handler as Handler<E>
            try {
                typed(payload)
            } catch {
                // An observer's failure is the observer's: the call it watches goes on.
            }
        }
    }
}
