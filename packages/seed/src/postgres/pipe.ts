/** Thrown inside a producer when its consumer stopped reading: the producer's transaction rolls back and the stream ends quietly. */
export class Cancelled extends Error {
    constructor() {
        super("the reader stopped before the end of the stream")
        this.name = "Cancelled"
    }
}

/**
 * Turns a producer that must run inside a callback (a transaction) into an async iterable with back pressure: `send` hands
 * over one item and resumes when the reader has taken it, so memory holds at most the item being read and the next one.
 * A reader that stops early cancels the producer (its next `send` throws `Cancelled`, which a transaction rolls back);
 * a producer that fails ends the stream with its error.
 */
export async function* streamed<T>(produce: (send: (item: T) => Promise<void>) => Promise<void>): AsyncGenerator<T, void, undefined> {
    const queue: T[] = []
    const state: { finished: boolean; cancelled: boolean; failure: { readonly cause: unknown } | null } = { finished: false, cancelled: false, failure: null }
    const wake: { reader: (() => void) | null; producer: (() => void) | null } = { reader: null, producer: null }
    const send = async (item: T): Promise<void> => {
        queue.push(item)
        wake.reader?.()
        await new Promise<void>((resolve) => {
            wake.producer = resolve
            if (state.cancelled) resolve()
        })
        if (state.cancelled) throw new Cancelled()
    }
    const running = produce(send).then(
        () => {
            state.finished = true
            wake.reader?.()
        },
        (cause: unknown) => {
            if (!(cause instanceof Cancelled)) state.failure = { cause }
            state.finished = true
            wake.reader?.()
        },
    )
    try {
        for (;;) {
            const next = queue.shift()
            if (next !== undefined) {
                wake.producer?.()
                yield next
                continue
            }
            if (state.finished) break
            await new Promise<void>((resolve) => {
                wake.reader = resolve
            })
        }
        if (state.failure !== null) throw state.failure.cause
    } finally {
        state.cancelled = true
        wake.producer?.()
        await running
    }
}
