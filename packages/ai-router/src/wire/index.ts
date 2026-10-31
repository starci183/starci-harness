import { presetOf } from "../providers.ts"
import type { ProviderConfig } from "../types.ts"
import { anthropicWire } from "./anthropic.ts"
import { openAiWire } from "./wire.ts"
import type { Wire } from "./wire.ts"

export type { Wire, WireEvent, WireRequest } from "./wire.ts"

/** The protocol adapter a provider is called through, by its kind. */
export function wireOf(provider: ProviderConfig): Wire {
    return presetOf(provider).protocol === "anthropic" ? anthropicWire : openAiWire
}
