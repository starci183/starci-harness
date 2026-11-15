import { isPlainRecord } from "@starci/common"
import { createHash } from "node:crypto"
import type { ProviderConfig } from "../types.ts"

/**
 * The thinking blocks of answers that call tools, kept in this process so the next request of the tool loop can send
 * the assistant turn back exactly as Anthropic produced it (docs/design.md, "Thinking with tools"). An OpenAI-shaped
 * client has no field for them, so nothing above the gateway can carry them.
 *
 * A turn is replayed only while everything sent before it is what was sent when it was produced: the API binds a
 * thinking block to that prefix (system, tools and earlier messages) and may refuse a block replayed after an edit. The
 * prefix is kept as a digest, never as text.
 */

/** One assistant turn as Anthropic answered it, and the digest of the request that produced it. */
export interface RememberedTurn {
    readonly content: readonly Record<string, unknown>[]
    readonly prefix: string
}

/** The most turns one provider keeps; the oldest is forgotten first. A forgotten turn is sent without its thinking. */
export const THINKING_MEMORY_LIMIT = 2000

/** Assistant turns by the ids of the tool calls they made, least recently used first. */
export class ThinkingMemory {
    readonly #turns = new Map<string, RememberedTurn>()
    readonly #limit: number

    constructor(limit: number = THINKING_MEMORY_LIMIT) {
        this.#limit = limit
    }

    /** The turn that made these tool calls, when it is still remembered. */
    get(key: string): RememberedTurn | undefined {
        const turn = this.#turns.get(key)
        if (turn === undefined) return undefined
        this.#turns.delete(key)
        this.#turns.set(key, turn)
        return turn
    }

    /** Remembers a turn, forgetting the least recently used one past the limit. */
    set(key: string, turn: RememberedTurn): void {
        this.#turns.delete(key)
        this.#turns.set(key, turn)
        const oldest: string | undefined = this.#turns.size > this.#limit ? this.#turns.keys().next().value : undefined
        if (oldest !== undefined) this.#turns.delete(oldest)
    }

    /** How many turns are remembered. */
    get size(): number {
        return this.#turns.size
    }
}

const memories = new WeakMap<ProviderConfig, ThinkingMemory>()

/** The memory of a provider that replays thinking; null for one that drops it (the default). */
export function memoryOf(provider: ProviderConfig): ThinkingMemory | null {
    if (provider.thinking !== "replay") return null
    let memory = memories.get(provider)
    if (memory === undefined) {
        memory = new ThinkingMemory()
        memories.set(provider, memory)
    }
    return memory
}

/** JSON with sorted keys and without cache breakpoints: neither key order nor a moved breakpoint is an edit of the prefix. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (!isPlainRecord(value)) return value
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) if (key !== "cache_control") out[key] = canonical(value[key])
    return out
}

/** The digest of a prefix extended by one more piece (the system and tools first, then each turn). */
export function digest(previous: string, piece: unknown): string {
    return createHash("sha256").update(previous).update("\n").update(JSON.stringify(canonical(piece))).digest("hex")
}
