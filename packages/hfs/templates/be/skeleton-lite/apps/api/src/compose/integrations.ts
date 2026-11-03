import type { DynamicModule, Provider } from "@nestjs/common"
import { OWN_TOKEN_VERIFIER, PASSPORT_OPTIONS } from "@modules/integrations/passport"
import type { VerifyAccessToken } from "@modules/integrations/passport"
import { objectStorageModule } from "@modules/integrations/object-storage"
import type { ApiOptions } from "../api.options"

/** The object storage package of the app, registered once with the app's typed settings. */
export const integrationModules = (options: ApiOptions): Array<DynamicModule> => [objectStorageModule(options.objectStorage)]

/** The passport integration ports bound once for this app. */
export const integrationProviders = (options: ApiOptions, verifyAccessToken: VerifyAccessToken): Array<Provider> => [
    { provide: PASSPORT_OPTIONS, useValue: options.passport },
    { provide: OWN_TOKEN_VERIFIER, useValue: verifyAccessToken },
]
