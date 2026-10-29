import type { Provider } from "@nestjs/common"
import { OWN_TOKEN_VERIFIER, PASSPORT_OPTIONS } from "@modules/integrations/passport"
import type { VerifyAccessToken } from "@modules/integrations/passport"
import { OBJECT_STORAGE, createObjectStorage } from "@modules/integrations/storage"
import type { ApiOptions } from "../api.options"

/** The passport and storage integration ports bound once for this app. */
export const integrationProviders = (options: ApiOptions, verifyAccessToken: VerifyAccessToken): Array<Provider> => [
    { provide: PASSPORT_OPTIONS, useValue: options.passport },
    { provide: OWN_TOKEN_VERIFIER, useValue: verifyAccessToken },
    { provide: OBJECT_STORAGE, useValue: createObjectStorage(options.storage) },
]
