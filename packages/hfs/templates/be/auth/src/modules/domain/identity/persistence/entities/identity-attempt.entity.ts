// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "public", name: "identity_attempts" })
/** The attempts of one kind and address in one window, mapped from public.identity_attempts; the address is hashed in the key. */
export class IdentityAttemptEntity {
    /** The kind and the digest of the address. */
    @PrimaryColumn({ name: "key", type: "varchar", length: 128 })
    key!: string

    /** The attempts counted in the window. */
    @Column({ name: "hits", type: "integer" })
    hits!: number

    /** When the window ends; an attempt after it opens a fresh one. */
    @Column({ name: "reset_at", type: "timestamptz" })
    resetAt!: Date
}
