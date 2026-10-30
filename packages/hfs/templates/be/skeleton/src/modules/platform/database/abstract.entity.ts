import { Column, PrimaryGeneratedColumn } from "typeorm"

/** The timestamp columns every table of a migration carries: an entity extends this base instead of declaring them; it maps no table itself. */
export abstract class AbstractEntity {
    /** When the row was created; the database sets it. */
    @Column({ name: "created_at", type: "timestamptz", insert: false, update: false })
    createdAt!: Date

    /** When the row last changed; the database trigger sets it. */
    @Column({ name: "updated_at", type: "timestamptz", insert: false, update: false })
    updatedAt!: Date
}

/** The timestamp columns plus the generated uuid key `id`: the base of a table keyed by one uuid; a composite-key table extends AbstractEntity. */
export abstract class UuidAbstractEntity extends AbstractEntity {
    /** The row id. */
    @PrimaryGeneratedColumn("uuid", { name: "id" })
    id!: string
}
