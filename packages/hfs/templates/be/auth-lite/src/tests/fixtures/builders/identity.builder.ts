// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
const BEFORE = new Date("2026-02-03T04:00:00.000Z")

/** The kinds of account the sign-in reads by address. */
export type AccountByEmailVariant = "live" | "disabled" | "unconfirmed" | "passwordless" | "invited"

/** The kinds of account the sign-in reads by id. */
export type AccountByIdVariant = "live" | "disabled" | "addressless"

/** A row of the by-address door: `disabled` is what the database decided at its own now(). */
export interface AccountByEmailRow {
    id: string
    email: string
    encrypted_password: string | null
    email_confirmed_at: Date | null
    disabled: boolean
}

/** A row of the by-id door. */
export interface AccountByIdRow {
    id: string
    email: string | null
    disabled: boolean
}

/** The row the by-address door answers for a confirmed password account of the given variant. */
export const accountByEmailRow = (variant: AccountByEmailVariant = "live"): AccountByEmailRow => ({
    id: "u-1",
    email: "a@example.test",
    encrypted_password: variant === "passwordless" || variant === "invited" ? null : "hash",
    email_confirmed_at: variant === "unconfirmed" || variant === "invited" ? null : BEFORE,
    disabled: variant === "disabled",
})

/** The row the by-id door answers for the account of the given variant; `id` is the account the spec stands for. */
export const accountByIdRow = (variant: AccountByIdVariant = "live", id = "u-1"): AccountByIdRow => ({
    id,
    email: variant === "addressless" ? null : "a@example.test",
    disabled: variant === "disabled",
})
