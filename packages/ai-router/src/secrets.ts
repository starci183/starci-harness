import { createHash } from "node:crypto"
import type { KeyConfig } from "./types.ts"

/** Reads a key's secret now: its env variable or its resolver, trimmed; undefined when absent, empty or the resolver throws. */
export async function resolveSecret(key: KeyConfig): Promise<string | undefined> {
    let value: string | undefined
    try {
        value = "env" in key ? process.env[key.env] : await key.resolve()
    } catch {
        return undefined
    }
    const trimmed = value?.trim()
    return trimmed === undefined || trimmed === "" ? undefined : trimmed
}

/**
 * The fingerprint the blacklist keeps of a secret, to notice a new one: 16 hex (64 bits) of a namespaced SHA-256, `""`
 * for no secret. It identifies a change; it cannot give the secret back.
 */
export function fingerprintOf(secret: string | undefined): string {
    if (secret === undefined) return ""
    return createHash("sha256").update(`ai-router:fingerprint:${secret}`, "utf8").digest("hex").slice(0, 16)
}
