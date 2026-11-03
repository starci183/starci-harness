import { OIDC_ERROR_KINDS } from "../contracts/index.ts"
import type { OidcErrorCode, OidcErrorKind } from "../contracts/index.ts"

/** The one error class the package throws: a stable code, the kind it travels as, the key a configuration error names and the cause, never provider prose or a token. */
export class OidcError extends Error {
    readonly code: OidcErrorCode
    readonly kind: OidcErrorKind
    readonly params: Readonly<Record<string, string>>

    constructor(code: OidcErrorCode, options: { readonly cause?: unknown; readonly params?: Readonly<Record<string, string>> } = {}) {
        super(code, options.cause === undefined ? undefined : { cause: options.cause })
        this.name = "OidcError"
        this.code = code
        this.kind = OIDC_ERROR_KINDS[code]
        this.params = options.params ?? {}
    }
}
