import type { Secret } from "@modules/platform/config/env-source.config"

/** The options of the AI integration (fixture): the gateway it calls and the virtual key it calls with. */
export interface AiOptions {
    readonly gatewayUrl: string
    readonly virtualKey: Secret
    readonly chatModel: string
}
