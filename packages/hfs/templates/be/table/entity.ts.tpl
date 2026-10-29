import { Column, Entity, PrimaryGeneratedColumn } from "typeorm"

/** One row of public.{{table}}, mapped from its creating migration in db/migrations; edit it beside every migration that changes the table. */
@Entity({ schema: "public", name: "{{table}}" })
export class {{Singular}}Entity {
    /** The row id. */
    @PrimaryGeneratedColumn("uuid", { name: "id" })
    id!: string

    /** The owning user (auth.users.id). */
    @Column({ name: "owner_id", type: "uuid" })
    ownerId!: string

    /** When the row was created; the database sets it. */
    @Column({ name: "created_at", type: "timestamptz", insert: false, update: false })
    createdAt!: Date

    /** When the row last changed; the database trigger sets it. */
    @Column({ name: "updated_at", type: "timestamptz", insert: false, update: false })
    updatedAt!: Date
}
