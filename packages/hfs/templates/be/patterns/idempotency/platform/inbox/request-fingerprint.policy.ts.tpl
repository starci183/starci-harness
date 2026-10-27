import { createHash } from "node:crypto"
import { IdempotencyError, IdempotencyErrorCode } from "@modules/platform/idempotency"

/** Serializes JSON without depending on object insertion order; array order remains part of the request. */
const serializeJson = (value: unknown, ancestors: Set<object>): string => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
    if (typeof value !== "object" || ancestors.has(value))
        throw new IdempotencyError({ code: IdempotencyErrorCode.RequestInvalid })
    ancestors.add(value)
    let serialized: string
    if (Array.isArray(value)) {
        serialized = `[${Array.from(value, (item: unknown) => serializeJson(item, ancestors)).join(",")}]`
    } else {
        const prototype: unknown = Object.getPrototypeOf(value)
        if (prototype !== Object.prototype && prototype !== null) {
            throw new IdempotencyError({ code: IdempotencyErrorCode.RequestInvalid })
        }
        serialized = `{${Object.keys(value)
            .sort((left, right) => Number(left > right) - Number(left < right))
            .map((key) => {
                const item: unknown = Reflect.get(value, key)
                return `${JSON.stringify(key)}:${serializeJson(item, ancestors)}`
            })
            .join(",")}}`
    }
    ancestors.delete(value)
    return serialized
}

/** Returns a stable JSON representation for both the request digest and the stored outcome. */
export const canonicalJson = (value: unknown): string => serializeJson(value, new Set())

/** Hashes the validated client request, so a reused key cannot silently apply a different body. */
export const requestFingerprint = (request: unknown): string =>
    createHash("sha256").update(canonicalJson(request)).digest("hex")
