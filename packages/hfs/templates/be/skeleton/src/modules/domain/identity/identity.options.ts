import type { Type } from "@nestjs/common"
import type { VerifyAccessToken } from "@modules/integrations/passport"
import type { CredentialAuthenticator } from "./credential.contracts"

/** The identity capability's credential and session verification options. */
export interface IdentityOptions {
    /** The app-owned authenticator of alternate credentials; a credential door fails closed while it is absent. */
    readonly credentialAuthenticator?: Type<CredentialAuthenticator>
    /** Cryptographically verifies one of the app's own access tokens before it can become a principal. */
    readonly verifyAccessToken: VerifyAccessToken
}
