// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
const BEFORE = new Date("2026-02-03T04:00:00.000Z")
const AFTER = new Date("2026-02-03T05:00:00.000Z")

/** The kinds of account a sign-in spec needs. */
export type AuthUserVariant = "live" | "banned" | "ban-ended" | "deleted" | "unconfirmed" | "addressless" | "passwordless" | "created"

/** A row of auth.users as the sign-in reads it (the shape of AuthUserEntity). */
export interface AuthUserRow {
    id: string
    aud: string | null
    role: string | null
    email: string | null
    encryptedPassword: string | null
    emailConfirmedAt: Date | null
    lastSignInAt: Date | null
    bannedUntil: Date | null
    deletedAt: Date | null
    isAnonymous: boolean
    createdAt: Date | null
    updatedAt: Date | null
}

/** Until when an account of this variant is banned, or null. */
const bannedUntilOf = (variant: AuthUserVariant): Date | null => {
    if (variant === "banned") return AFTER
    return variant === "ban-ended" ? BEFORE : null
}

/** A confirmed, live password account of the given variant; \`created\` is the account the first Google sign-in makes (the first id the fake ids hand out). */
export const authUserRow = (variant: AuthUserVariant = "live"): AuthUserRow => ({
    id: variant === "created" ? "00000000-0000-4000-8000-000000000001" : "u-1",
    aud: "authenticated",
    role: "authenticated",
    email: variant === "addressless" ? null : "a@example.test",
    encryptedPassword: variant === "passwordless" || variant === "created" ? null : "hash",
    emailConfirmedAt: variant === "unconfirmed" ? null : BEFORE,
    lastSignInAt: null,
    bannedUntil: bannedUntilOf(variant),
    deletedAt: variant === "deleted" ? BEFORE : null,
    isAnonymous: false,
    createdAt: BEFORE,
    updatedAt: BEFORE,
})
