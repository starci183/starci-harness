// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "auth", name: "identities" })
/** One external identity of an account (a Google subject), mapped from auth.identities of db/bootstrap.sql. */
export class AuthIdentityEntity {
    /** The row id. */
    @PrimaryColumn({ name: "id", type: "uuid" })
    id!: string

    /** The provider's id of the person (the Google subject). */
    @Column({ name: "provider_id", type: "text" })
    providerId!: string

    /** The account the identity belongs to. */
    @Column({ name: "user_id", type: "uuid" })
    userId!: string

    /** What the provider told us, as JSON. */
    @Column({ name: "identity_data", type: "jsonb" })
    identityData!: Record<string, string | boolean | null>

    /** The provider name. */
    @Column({ name: "provider", type: "text" })
    provider!: string

    /** The last sign-in through this identity, or null. */
    @Column({ name: "last_sign_in_at", type: "timestamptz", nullable: true })
    lastSignInAt!: Date | null

    /** When the identity was linked. */
    @Column({ name: "created_at", type: "timestamptz", nullable: true })
    createdAt!: Date | null

    /** When the identity last changed. */
    @Column({ name: "updated_at", type: "timestamptz", nullable: true })
    updatedAt!: Date | null
}
