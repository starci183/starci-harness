import { EXIT_USAGE, Refusal } from "./errors.js"
import { EVERYONE, spellingOf } from "./verb.js"
import type { AnyVerb, Role } from "./verb.js"

/** The environment variable that names the caller's role; unset or empty, roles are declared and not enforced. */
export const ROLE_ENV = "STARCI_ROLE"

const isRole = (value: string): value is Role => (EVERYONE as readonly string[]).includes(value)

/**
 * The caller's role from STARCI_ROLE, or undefined when it is not set (nothing is enforced then). A value that is not a role is
 * a usage error, never a silent "everyone".
 */
export const callerRole = (env: NodeJS.ProcessEnv = process.env): Role | undefined => {
    const value = env[ROLE_ENV]?.trim()
    if (value === undefined || value === "") return undefined
    if (!isRole(value)) throw new Refusal("ROLE_UNKNOWN", `${ROLE_ENV}=${value} is not a role; roles: ${EVERYONE.join(", ")}`, EXIT_USAGE)
    return value
}

/** Refuses ROLE_REFUSED when STARCI_ROLE names a role the verb's `roles` do not list; with no STARCI_ROLE every verb runs. */
export const assertRole = (verb: AnyVerb, env: NodeJS.ProcessEnv = process.env): void => {
    const role = callerRole(env)
    if (role === undefined || verb.roles.includes(role)) return
    throw new Refusal("ROLE_REFUSED", `starci ${spellingOf(verb)} is for ${verb.roles.join(", ")}; ${ROLE_ENV} says this caller is ${role}`)
}
