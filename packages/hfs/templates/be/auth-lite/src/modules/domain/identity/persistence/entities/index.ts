// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { IdentityAttemptEntity } from "./identity-attempt.entity"
import { IdentityEmailTokenEntity } from "./identity-email-token.entity"
import { IdentityRefreshTokenEntity } from "./identity-refresh-token.entity"
import { IdentitySessionEntity } from "./identity-session.entity"

export { IdentityAttemptEntity, IdentityEmailTokenEntity, IdentityRefreshTokenEntity, IdentitySessionEntity }

/** The entities of the identity capability, named in PRIMARY_ENTITIES of platform/database/entities.ts. */
export const identityEntities: ReadonlyArray<new () => object> = [
    IdentityAttemptEntity,
    IdentityEmailTokenEntity,
    IdentityRefreshTokenEntity,
    IdentitySessionEntity,
]
