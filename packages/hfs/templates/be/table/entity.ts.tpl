import { UuidAbstractEntity } from "@modules/platform/database"
import { Column, Entity } from "typeorm"

@Entity({ schema: "public", name: "{{table}}" })
/** One row of public.{{table}}, mapped from its creating migration in db/migrations; edit it beside every migration that changes the table. Its id, created_at and updated_at come from UuidAbstractEntity. */
export class {{Singular}}Entity extends UuidAbstractEntity {
    /** The owning user (auth.users.id). */
    @Column({ name: "owner_id", type: "uuid" })
    ownerId!: string
}
