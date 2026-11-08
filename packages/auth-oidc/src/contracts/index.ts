/** @deprecated `@starci/auth-oidc/contracts` is retired: import `@starci/auth/oidc` (`starci app codemod auth-merge` rewrites the imports). The names are the OIDC contract of 0.2.0. */
export {
    OIDC_ACCESS_TOKEN_INVALID,
    OIDC_ALGORITHMS,
    OIDC_CLAIMS,
    OIDC_CLIENT_CODES,
    OIDC_DEFAULT_ALGORITHMS,
    OIDC_ERROR_CODES,
    OIDC_ERROR_KINDS,
    OIDC_ROLE,
    OIDC_ROLE_BOUNDS,
    OIDC_SUBJECT_MAX_LENGTH,
} from "@starci/auth/oidc"
export type {
    OidcAlgorithm,
    OidcClientOutcome,
    OidcErrorCode,
    OidcErrorKind,
    OidcFailureKind,
    OidcIdentity,
    OidcOutcome,
    OidcPrincipal,
    OidcRefusal,
    OidcRefusalReason,
    OidcSessionUser,
    PrincipalVerifier,
} from "@starci/auth/oidc"
