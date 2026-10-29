import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { AuthGuard, CredentialGuard } from "@modules/domain/identity"
import { tokenKit } from "@modules/integrations/passport"
import { ErrorsFilter } from "@modules/platform/errors"
import { OriginGuard, RateLimitGuard } from "@modules/platform/http-security"
import { platformModules } from "./compose/platform"
import { domainModules } from "./compose/domain"
import { systemModules } from "./compose/system"
import { apiModules } from "./compose/api"
import { webhooksModules } from "./compose/webhooks"
import { integrationProviders } from "./compose/integrations"
import type { ApiOptions } from "./api.options"

@Module({})
/** Composition root of the API: it spreads the composition groups of `compose/`, and the four guards run in a fixed order. */
export class AppModule {
    /** Builds the module from options parsed once at boot; nothing here reads the environment. */
    static register(options: ApiOptions): DynamicModule {
        const tokens = tokenKit(options.passport.tokens)
        return {
            module: AppModule,
            imports: [
                ...platformModules(options),
                ...domainModules(tokens.verify),
                ...systemModules(),
                ...apiModules(),
                ...webhooksModules(),
            ],
            providers: [
                ...integrationProviders(options, tokens.verify),
                { provide: APP_FILTER, useClass: ErrorsFilter },
                { provide: APP_GUARD, useClass: RateLimitGuard },
                { provide: APP_GUARD, useClass: OriginGuard },
                { provide: APP_GUARD, useClass: CredentialGuard },
                { provide: APP_GUARD, useClass: AuthGuard },
            ],
        }
    }
}
