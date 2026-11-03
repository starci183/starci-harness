// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "auth", name: "users" })
/** One person who can sign in, mapped from auth.users of db/bootstrap.sql (the GoTrue column set; only the columns sign-in reads or writes). */
export class AuthUserEntity {
    /** The account id. */
    @PrimaryColumn({ name: "id", type: "uuid" })
    id!: string

    /** The audience the row carries. */
    @Column({ name: "aud", type: "varchar", length: 255, nullable: true })
    aud!: string | null

    /** The database role the row carries. */
    @Column({ name: "role", type: "varchar", length: 255, nullable: true })
    role!: string | null

    /** The sign-in address, lower-cased. */
    @Column({ name: "email", type: "varchar", length: 255, nullable: true })
    email!: string | null

    /** The bcrypt hash of the password, or null for an account that signs in with Google only. */
    @Column({ name: "encrypted_password", type: "varchar", length: 255, nullable: true })
    encryptedPassword!: string | null

    /** When the mailbox was confirmed, or null. */
    @Column({ name: "email_confirmed_at", type: "timestamptz", nullable: true })
    emailConfirmedAt!: Date | null

    /** The last sign-in, or null. */
    @Column({ name: "last_sign_in_at", type: "timestamptz", nullable: true })
    lastSignInAt!: Date | null

    /** Until when the account is banned, or null. */
    @Column({ name: "banned_until", type: "timestamptz", nullable: true })
    bannedUntil!: Date | null

    /** When the account was deleted, or null. */
    @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
    deletedAt!: Date | null

    /** True for an anonymous account, which never signs in with an address. */
    @Column({ name: "is_anonymous", type: "boolean" })
    isAnonymous!: boolean

    /** When the account was created. */
    @Column({ name: "created_at", type: "timestamptz", nullable: true })
    createdAt!: Date | null

    /** When the account last changed. */
    @Column({ name: "updated_at", type: "timestamptz", nullable: true })
    updatedAt!: Date | null
}
