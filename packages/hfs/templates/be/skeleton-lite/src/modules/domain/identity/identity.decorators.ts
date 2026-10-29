import { SetMetadata, applyDecorators, createParamDecorator } from "@nestjs/common"
import type { ExecutionContext } from "@nestjs/common"
import { injector } from "@modules/platform/composition"
import type { DoorDecorator, TypedParameterDecorator } from "@modules/platform/composition"
import type { VerifyAccessToken } from "@modules/integrations/passport"
import { ServerToServer, requestOf } from "@modules/platform/http-security"
import type { Principal } from "@modules/platform/cqrs"
import type { CredentialAuthenticator, CredentialMetadata } from "./credential.contracts"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { PublicReason } from "./identity.contracts"
import type { PublicMetadata } from "./identity.contracts"

/** Token of the access-token verifier the composition root hands to identity. */
export const ACCESS_TOKEN_VERIFIER: unique symbol = Symbol("domain.identity.access-token-verifier")

/** Injects the access-token verifier identity was registered with. Parameter type: VerifyAccessToken. */
export const InjectAccessTokenVerifier = (): TypedParameterDecorator<VerifyAccessToken> =>
    injector<VerifyAccessToken>(ACCESS_TOKEN_VERIFIER)

/** Metadata key of `@Public`. */
export const PUBLIC_KEY = "domain.identity.public"

/**
 * Opens a door to anonymous callers, stating why; every other door needs a credential or a verified session.
 * A signed webhook proves its caller by its signature, so it owes no browser origin.
 */
export const Public = (metadata: PublicMetadata): DoorDecorator =>
    metadata.reason === PublicReason.SignedWebhook
        ? applyDecorators(SetMetadata(PUBLIC_KEY, metadata), ServerToServer())
        : applyDecorators(SetMetadata(PUBLIC_KEY, metadata))

/** Metadata key of `@Credential`. */
export const CREDENTIAL_KEY: unique symbol = Symbol("domain.identity.credential")

/** Token of the identity-owned port that authenticates an API key, run token, tool token or link token. */
export const CREDENTIAL_AUTHENTICATOR: unique symbol = Symbol("domain.identity.credential-authenticator")

/** Injects the credential authenticator identity was registered with. Parameter type: CredentialAuthenticator. */
export const InjectCredentialAuthenticator = (): TypedParameterDecorator<CredentialAuthenticator> =>
    injector<CredentialAuthenticator>(CREDENTIAL_AUTHENTICATOR)

/**
 * Marks a door authenticated by its own credential; `CredentialGuard` authenticates it and `AuthGuard` admits it. The
 * credential travels in a header no browser attaches by itself, so the door owes no browser origin.
 */
export const Credential = (metadata: CredentialMetadata): DoorDecorator =>
    applyDecorators(SetMetadata(CREDENTIAL_KEY, metadata), ServerToServer())

/** The authenticated caller established by the default-deny guard. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
    const principal = requestOf(context).principal
    if (!principal) throw new IdentityError({ code: IdentityErrorCode.Unauthenticated })
    return principal
})
