// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "public", name: "identity_sessions" })
/** One device session, mapped from public.identity_sessions of the baseline migration (the tables of @starci/auth). */
export class IdentitySessionEntity {
    /** The session id. */
    @PrimaryColumn({ name: "id", type: "uuid" })
    id!: string

    /** The account the session belongs to. */
    @Column({ name: "user_id", type: "uuid" })
    userId!: string

    /** When the session opened. */
    @Column({ name: "created_at", type: "timestamptz" })
    createdAt!: Date

    /** When the session last refreshed. */
    @Column({ name: "refreshed_at", type: "timestamptz" })
    refreshedAt!: Date

    /** The bounded user agent that opened the session. */
    @Column({ name: "user_agent", type: "text", nullable: true })
    userAgent!: string | null

    /** The caller address that opened the session. */
    @Column({ name: "ip", type: "text", nullable: true })
    ip!: string | null
}
