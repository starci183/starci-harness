import type { VerifyAccessToken } from "@modules/integrations/passport"

/** The options of the @@channel@@ socket transport: the cryptographic verifier that authenticates each connection. */
export interface @@Channel@@WebsocketOptions {
    /** Verifies the access token of a handshake with the same verifier identity uses. */
    readonly verifyAccessToken: VerifyAccessToken
}
