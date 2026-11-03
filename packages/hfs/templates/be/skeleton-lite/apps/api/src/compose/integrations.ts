import type { DynamicModule, Provider } from "@nestjs/common"
import { OWN_TOKEN_VERIFIER, PASSPORT_OPTIONS, passportModule } from "@modules/integrations/passport"
import type { VerifyAccessToken } from "@modules/integrations/passport"
import { OBJECT_STORAGE, createObjectStorage } from "@modules/integrations/object-storage"
import type { ApiOptions } from "../api.options"

/** The sign-in package of the app, registered once with the app's typed settings. */
export const integrationModules = (options: ApiOptions): Array<DynamicModule> => [passportModule(options.passport, { isGlobal: true })]

/** The passport and object-storage integration ports bound once for this app. */
export const integrationProviders = (options: ApiOptions, verifyAccessToken: VerifyAccessToken): Array<Provider> => [
    { provide: PASSPORT_OPTIONS, useValue: options.passport },
    { provide: OWN_TOKEN_VERIFIER, useValue: verifyAccessToken },
    { provide: OBJECT_STORAGE, useValue: createObjectStorage(options.objectStorage) },
]
