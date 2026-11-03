// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import type { EntityManager } from "typeorm"
import { callDbFunction, returnedRows, rowShape } from "@modules/platform/database"

/** The account an address stands for, with the stored hash the password is checked against. */
export interface AccountByEmail {
    /** The account id. */
    readonly id: string
    /** The sign-in address. */
    readonly email: string
    /** The stored bcrypt hash, or null for an account that signs in with Google only. */
    readonly encrypted_password: string | null
    /** When the mailbox was confirmed, or null. */
    readonly email_confirmed_at: Date | null
    /** True when the account is deleted or banned at the database's now(). */
    readonly disabled: boolean
}

/** The standing of an account found by id. */
export interface AccountById {
    /** The account id. */
    readonly id: string
    /** The sign-in address, or null. */
    readonly email: string | null
    /** True when the account is deleted or banned at the database's now(). */
    readonly disabled: boolean
}

/** An account to create: the id, the address, the profile keys as JSON text and the instant. */
export interface NewAccount {
    /** The account id. */
    readonly id: string
    /** The sign-in address, lower-cased. */
    readonly email: string
    /** The bcrypt hash, or null for an account that signs in with Google only. */
    readonly hash: string | null
    /** Whether the mailbox counts as confirmed. */
    readonly confirmed: boolean
    /** The profile keys as JSON text. */
    readonly meta: string
    /** The instant of creation. */
    readonly now: Date
}

const isAccountByEmail: (value: unknown) => value is AccountByEmail = rowShape({
    id: "string",
    email: "string",
    encrypted_password: "string?",
    email_confirmed_at: "date?",
    disabled: "boolean",
})
const isAccountById: (value: unknown) => value is AccountById = rowShape({ id: "string", email: "string?", disabled: "boolean" })
const isLinkedAccount = rowShape({ be_auth_user_by_google: "string?" })
const isCreatedAccount = rowShape({ be_auth_create_user: "string" })

/**
 * The account doors: the SECURITY DEFINER functions of the baseline migration through which the application role reads and writes
 * auth.users and auth.identities. It holds no grant on schema auth, so no other path reaches an account.
 */
export const accountDoors = {
    /** The account of an exact address, or undefined. */
    async userByEmail(manager: EntityManager, email: string): Promise<AccountByEmail | undefined> {
        const [row] = returnedRows(await callDbFunction(manager, "public.be_auth_user_by_email", [email]), isAccountByEmail)
        return row
    },
    /** The standing of an account by id, or undefined. */
    async userById(manager: EntityManager, userId: string): Promise<AccountById | undefined> {
        const [row] = returnedRows(await callDbFunction(manager, "public.be_auth_user_by_id", [userId]), isAccountById)
        return row
    },
    /** The account a Google subject is linked to, or null. */
    async userByGoogle(manager: EntityManager, subject: string): Promise<string | null> {
        const [row] = returnedRows(await callDbFunction(manager, "public.be_auth_user_by_google", [subject]), isLinkedAccount)
        return row?.be_auth_user_by_google ?? null
    },
    /** Creates an account and answers its id. */
    async createUser(manager: EntityManager, account: NewAccount): Promise<string | undefined> {
        const args = [account.id, account.email, account.hash, account.confirmed, account.meta, account.now]
        const [row] = returnedRows(await callDbFunction(manager, "public.be_auth_create_user", args), isCreatedAccount)
        return row?.be_auth_create_user
    },
    /** Links a Google subject to an account, or refreshes the link. */
    async linkGoogle(manager: EntityManager, userId: string, subject: string, data: string, now: Date): Promise<void> {
        await callDbFunction(manager, "public.be_auth_link_google", [userId, subject, data, now])
    },
    /** Stamps the confirmation of a mailbox (a spent confirmation link) without recording a sign-in. */
    async confirmUser(manager: EntityManager, userId: string, now: Date): Promise<void> {
        await callDbFunction(manager, "public.be_auth_confirm_user", [userId, now])
    },
    /** Sets the password hash of an account; `confirm` also confirms the mailbox, as a spent reset link proves it. */
    async setPassword(manager: EntityManager, userId: string, hash: string, confirm: boolean, now: Date): Promise<void> {
        await callDbFunction(manager, "public.be_auth_set_password", [userId, hash, confirm, now])
    },
    /** Records a sign-in, confirms the mailbox when asked, and fills the profile keys the person has not set. */
    async touchUser(manager: EntityManager, userId: string, now: Date, confirm: boolean, meta: string): Promise<void> {
        await callDbFunction(manager, "public.be_auth_touch_user", [userId, now, confirm, meta])
    },
}
