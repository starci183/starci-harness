import { AttemptError } from "./attempt.ts"

/**
 * The first `dimensions` numbers of a vector, scaled to unit length (L2): the Matryoshka cut. A model trained with
 * Matryoshka representation learning packs its meaning into the leading numbers, so the prefix is a valid smaller
 * embedding once renormalized, and the prefix of the same text at a smaller size is the prefix of the larger one up to
 * that scale. A vector of exactly `dimensions` is returned as it is. A vector shorter than asked, or a base64 one, cannot
 * be cut: the request is the caller's to fix, so the attempt fails as `invalid_request`.
 */
export function truncateVector(embedding: readonly number[] | string, dimensions: number): readonly number[] {
    if (typeof embedding === "string") throw new AttemptError("invalid_request", "a truncated embedding is a list of numbers, not base64")
    if (embedding.length < dimensions) throw new AttemptError("invalid_request", `the model answers ${String(embedding.length)}-dimensional vectors, which cannot be cut to ${String(dimensions)}`)
    if (embedding.length === dimensions) return embedding
    const head = embedding.slice(0, dimensions)
    const norm = Math.sqrt(head.reduce((sum, value) => sum + value * value, 0))
    return norm === 0 ? head : head.map((value) => value / norm)
}
