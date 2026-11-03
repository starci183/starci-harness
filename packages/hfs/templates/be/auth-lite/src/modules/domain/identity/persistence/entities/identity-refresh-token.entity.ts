// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "public", name: "identity_refresh_tokens" })
/** One refresh token of a device session, mapped from public.identity_refresh_tokens; only its digest is stored, and a spent token is kept for replay detection. */
export class IdentityRefreshTokenEntity {
    /** The row id. */
    @PrimaryColumn({ name: "id", type: "uuid" })
    id!: string

    /** The device session the token belongs to. */
    @Column({ name: "session_id", type: "uuid" })
    sessionId!: string

    /** The account the session belongs to. */
    @Column({ name: "user_id", type: "uuid" })
    userId!: string

    /** The digest of the token, unique. */
    @Column({ name: "token_hash", type: "text" })
    tokenHash!: string

    /** When the row was written. */
    @Column({ name: "created_at", type: "timestamptz" })
    createdAt!: Date

    /** When the token stops working. */
    @Column({ name: "expires_at", type: "timestamptz" })
    expiresAt!: Date

    /** When the token was rotated away, or null while it is the live one. */
    @Column({ name: "used_at", type: "timestamptz", nullable: true })
    usedAt!: Date | null

    /** How many successors replays of this token obtained within the grace window after its rotation (bounded). */
    @Column({ name: "raced_count", type: "integer", default: 0 })
    racedCount!: number
}
