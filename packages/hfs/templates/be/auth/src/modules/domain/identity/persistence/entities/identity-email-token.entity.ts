// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "public", name: "identity_email_tokens" })
/** One single-use link token that confirms a mailbox or resets a password, mapped from public.identity_email_tokens; only its digest is kept. */
export class IdentityEmailTokenEntity {
    /** The token row id. */
    @PrimaryColumn({ name: "id", type: "uuid" })
    id!: string

    /** The account the link is for. */
    @Column({ name: "user_id", type: "uuid" })
    userId!: string

    /** What the link does: `confirm` or `reset`. */
    @Column({ name: "purpose", type: "varchar", length: 16 })
    purpose!: string

    /** The SHA-256 digest of the token in the link; the token itself is never stored. */
    @Column({ name: "token_hash", type: "varchar", length: 64 })
    tokenHash!: string

    /** When the link stops working. */
    @Column({ name: "expires_at", type: "timestamptz" })
    expiresAt!: Date

    /** When the link was spent, or null while it is live. */
    @Column({ name: "used_at", type: "timestamptz", nullable: true })
    usedAt!: Date | null

    /** When the link was issued. */
    @Column({ name: "created_at", type: "timestamptz" })
    createdAt!: Date
}
