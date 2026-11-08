import type { OidcAlgorithm, OidcPrincipal } from "../../contracts/oidc.ts"
import { OIDC_DEFAULT_ALGORITHMS } from "../../contracts/oidc.ts"
import type { OidcOptions, OidcRoleMapping } from "../options.ts"
import { principalOf } from "../verifier.ts"
import type { IssuerEndpoints, IssuerPreset } from "./issuer.ts"
import { mapped, unmapped } from "./issuer.ts"

/** A Keycloak realm and what its access tokens must say. */
export interface KeycloakIssuerOptions {
    /** The Keycloak origin (`https://id.example.com`). */
    readonly origin: string
    /** The realm. */
    readonly realm: string
    /** The audience an access token must name: one of these. */
    readonly audience: string | readonly string[]
    /** The algorithms (`RS256`, what Keycloak signs with by default). */
    readonly algorithms?: readonly OidcAlgorithm[] | undefined
    /** When set, an access token's `azp` must equal it. */
    readonly authorizedParty?: string | undefined
    /** Which roles become the principal's roles (the realm roles). */
    readonly roles?: OidcRoleMapping | undefined
    /** A test double's issuer (its keys come from its discovery document like Keycloak's). */
    readonly endpoints?: Pick<IssuerEndpoints, "issuer"> | undefined
}

/** The issuer address of a Keycloak realm: `<origin>/realms/<realm>`. */
export const keycloakIssuerUrl = (origin: string, realm: string): string => `${origin.replace(/\/+$/u, "")}/realms/${encodeURIComponent(realm)}`

/** The trust half of an `OidcModule` registration for a Keycloak realm: spread it with the app's transport (`OidcModule.register({ ...keycloakOptions(o), http, clock })`). */
export const keycloakOptions = (options: KeycloakIssuerOptions): Pick<OidcOptions, "issuer" | "audience" | "algorithms" | "authorizedParty" | "roles"> => ({
    issuer: options.endpoints?.issuer ?? keycloakIssuerUrl(options.origin, options.realm),
    audience: options.audience,
    algorithms: options.algorithms ?? OIDC_DEFAULT_ALGORITHMS,
    authorizedParty: options.authorizedParty,
    roles: options.roles,
})

/** The Keycloak preset: realm access tokens, keys from the realm's discovery document, the principal the module's verifier builds. */
export const keycloakIssuer = (options: KeycloakIssuerOptions): IssuerPreset<OidcPrincipal> => {
    const trust = keycloakOptions(options)
    const audience = typeof options.audience === "string" ? [options.audience] : options.audience
    const rules = {
        issuer: trust.issuer,
        authorizedParty: options.authorizedParty,
        realmRoles: options.roles?.realm ?? true,
        roleClients: options.roles?.clients ?? [],
        roleClaims: options.roles?.claims ?? [],
    }
    return {
        name: "keycloak",
        issuer: trust.issuer,
        issuerAliases: [],
        keys: { kind: "discovery" },
        algorithms: trust.algorithms ?? OIDC_DEFAULT_ALGORITHMS,
        audience,
        requiredClaims: [],
        identityOf: (claims) => {
            const principal = principalOf(claims, rules)
            if (principal.kind === "ok") return mapped(principal.value)
            const reason = principal.detail?.reason
            return unmapped(reason === "token-type" || reason === "authorized-party" ? reason : "claims")
        },
    }
}
