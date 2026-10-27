import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity("inbox_claims")
/** One row per event a consumer or webhook has claimed: the pair (source, event id) is unique. */
export class InboxClaimEntity {
    /** The consumer queue or webhook the event arrived through. */
    @PrimaryColumn({ name: "source", type: "varchar", length: 200 })
    source!: string

    /** The event id the provider or producer supplied. */
    @PrimaryColumn({ name: "event_id", type: "varchar", length: 200 })
    eventId!: string

    /** When the event was claimed. */
    @Column({ name: "claimed_at", type: "timestamptz" })
    claimedAt!: Date

    /** The canonical JSON request's SHA-256; null for provider and broker deliveries. */
    @Column({ name: "request_fingerprint", type: "varchar", length: 64, nullable: true })
    requestFingerprint!: string | null

    /** A completed client operation's JSON envelope, including expected refusals. */
    @Column({ name: "outcome", type: "jsonb", nullable: true })
    outcome!: object | null
}
