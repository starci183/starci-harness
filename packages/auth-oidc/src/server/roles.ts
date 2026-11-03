import { OIDC_CLAIMS, OIDC_ROLE_BOUNDS } from "../contracts/index.ts"
import { isRecord } from "./primitives.ts"

/** Which claims hold roles. */
export interface RoleSources {
    readonly realm: boolean
    readonly clients: readonly string[]
    readonly claims: readonly string[]
}

/** The roles of a claim value shaped `{ roles: string[] }`, or undefined when the shape is wrong. */
const rolesOfContainer = (value: unknown): readonly string[] | undefined => {
    if (value === undefined) return []
    return isRecord(value) ? rolesOfList(value.roles) : undefined
}

/** The roles of a claim value shaped `string[]`, or undefined when it is not one of bounded text. */
const rolesOfList = (value: unknown): readonly string[] | undefined => {
    if (value === undefined) return []
    if (!Array.isArray(value) || value.length > OIDC_ROLE_BOUNDS.maxRoles) return undefined
    const list: unknown[] = value
    const texts = list.filter((role): role is string => typeof role === "string" && role.length > 0 && role.length <= OIDC_ROLE_BOUNDS.maxLength)
    return texts.length === list.length ? texts : undefined
}

/**
 * The roles a verified token grants: `realm_access.roles` (when the mapping reads the realm), `resource_access.<client>.roles` of each
 * mapped client and each mapped flat claim. Sorted, without repeats. A claim of the wrong shape, or past the bounds, makes the whole
 * token untrusted (`undefined`): a role is an authorization input, so it is never guessed from a malformed claim.
 */
export const rolesOf = (payload: Readonly<Record<string, unknown>>, sources: RoleSources): readonly string[] | undefined => {
    const granted = new Set<string>()
    const add = (roles: readonly string[] | undefined): boolean => {
        if (roles === undefined) return false
        for (const role of roles) granted.add(role)
        return true
    }
    if (sources.realm && !add(rolesOfContainer(payload[OIDC_CLAIMS.realmAccess]))) return undefined
    if (sources.clients.length > 0) {
        const access = payload[OIDC_CLAIMS.resourceAccess]
        if (access !== undefined && !isRecord(access)) return undefined
        for (const client of sources.clients) {
            if (!add(rolesOfContainer(access === undefined ? undefined : access[client]))) return undefined
        }
    }
    for (const claim of sources.claims) {
        if (!add(rolesOfList(payload[claim]))) return undefined
    }
    if (granted.size > OIDC_ROLE_BOUNDS.maxRoles) return undefined
    return [...granted].sort()
}
