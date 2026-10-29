import { Column, Entity, PrimaryGeneratedColumn } from "typeorm"

@Entity({ schema: "public", name: "@@table@@" })
/** One @@provider@@ delivery receipt, a row of public.@@table@@ from its inbox migration in db/migrations; a reactor or job consumes it after commit. */
export class @@Provider@@InboxEntity {
    /** The receipt id the winning claim answers. */
    @PrimaryGeneratedColumn("uuid", { name: "id" })
    id!: string

    /** The provider the receipt belongs to; the table admits only @@provider@@. */
    @Column({ name: "provider", type: "text" })
    provider!: string

    /** The provider's delivery id, unique with the provider. */
    @Column({ name: "delivery_id", type: "text" })
    deliveryId!: string

    /** When the delivery was recorded; the database sets it. */
    @Column({ name: "received_at", type: "timestamptz", insert: false, update: false })
    receivedAt!: Date

    /** The verified delivery body the consumer reads; it carries no credential. */
    @Column({ name: "payload", type: "jsonb" })
    payload!: object

    /** When the consumer finished the delivery; null while it is pending. */
    @Column({ name: "processed_at", type: "timestamptz", nullable: true })
    processedAt!: Date | null
}
