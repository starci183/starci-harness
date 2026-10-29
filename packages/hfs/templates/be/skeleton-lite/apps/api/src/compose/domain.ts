import type { DynamicModule, Type } from "@nestjs/common"
import { IdentityModule } from "@modules/domain/identity"
import { LivenessModule } from "@modules/domain/liveness"
import type { VerifyAccessToken } from "@modules/integrations/passport"

/** The domain capabilities of the API, with the verifier of the app's own access tokens. */
export const domainModules = (verifyAccessToken: VerifyAccessToken): Array<Type<unknown> | DynamicModule> => [
    IdentityModule.register({ isGlobal: true, verifyAccessToken }),
    LivenessModule.register({ isGlobal: true }),
]
