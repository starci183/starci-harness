// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { AuthIdentityEntity } from "./auth-identity.entity"
import { AuthUserEntity } from "./auth-user.entity"
import { IdentityAttemptEntity } from "./identity-attempt.entity"
import { IdentityEmailTokenEntity } from "./identity-email-token.entity"
import { IdentityRefreshTokenEntity } from "./identity-refresh-token.entity"
import { IdentitySessionEntity } from "./identity-session.entity"

export { AuthIdentityEntity, AuthUserEntity, IdentityAttemptEntity, IdentityEmailTokenEntity, IdentityRefreshTokenEntity, IdentitySessionEntity }

/** The entities of the identity capability, named in PRIMARY_ENTITIES of platform/database/entities.ts. */
export const identityEntities: ReadonlyArray<new () => object> = [
    AuthIdentityEntity,
    AuthUserEntity,
    IdentityAttemptEntity,
    IdentityEmailTokenEntity,
    IdentityRefreshTokenEntity,
    IdentitySessionEntity,
]
