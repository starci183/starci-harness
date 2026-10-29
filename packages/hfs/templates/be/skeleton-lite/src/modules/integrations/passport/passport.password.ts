import { compare, hash } from "bcryptjs"

/** The bcrypt cost of a new password hash; existing `$2a$`/`$2b$` hashes (auth.users.encrypted_password) verify at their own cost. */
const COST = 12

/** Hashes a new password with bcrypt. */
export const hashPassword = (password: string): Promise<string> => hash(password, COST)

/** True when `password` matches the stored bcrypt hash; a missing hash never matches. */
export const verifyPassword = async (password: string, stored: string | null): Promise<boolean> =>
    stored === null ? false : compare(password, stored)
