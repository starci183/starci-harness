import type { DynamicModule, Provider } from "@nestjs/common"
import { OWN_TOKEN_VERIFIER, PASSPORT_OPTIONS, passportModule } from "@modules/integrations/passport"
import type { VerifyAccessToken } from "@modules/integrations/passport"
import { MailModule } from "@modules/integrations/mail"
import { ObjectStorageModule } from "@modules/integrations/object-storage"
import type { ApiOptions } from "../api.options"

/** The sign-in, object storage and mail packages of the app, each registered once with the app's typed settings. */
export const integrationModules = (options: ApiOptions): Array<DynamicModule> => [
    passportModule(options.passport, { isGlobal: true }),
    ObjectStorageModule.register({ ...options.objectStorage, isGlobal: true }),
    MailModule.register({ ...options.mail, isGlobal: true }),
]

/** The passport integration ports bound once for this app. */
export const integrationProviders = (options: ApiOptions, verifyAccessToken: VerifyAccessToken): Array<Provider> => [
    { provide: PASSPORT_OPTIONS, useValue: options.passport },
    { provide: OWN_TOKEN_VERIFIER, useValue: verifyAccessToken },
]
