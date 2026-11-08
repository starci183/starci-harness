import { DomainError } from "@starci/common"
import { OIDC_ERROR_KINDS } from "../contracts/oidc.ts"
import type { OidcErrorCode, OidcErrorKind } from "../contracts/oidc.ts"

/** The one error class the package throws: a stable code, the kind it travels as, the key a configuration error names and the cause, never provider prose or a token. */
export class OidcError extends DomainError<OidcErrorCode> {
    readonly kind: OidcErrorKind

    constructor(code: OidcErrorCode, options: { readonly cause?: unknown; readonly params?: Readonly<Record<string, string>> } = {}) {
        super({ code, params: options.params ?? {}, ...(options.cause === undefined ? {} : { cause: options.cause }) })
        this.kind = OIDC_ERROR_KINDS[code]
    }
}
