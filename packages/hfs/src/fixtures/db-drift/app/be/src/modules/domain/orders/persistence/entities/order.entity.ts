import { Column, Entity, PrimaryColumn } from "typeorm"
import { OrderKind } from "../../order-kind"

/** One order row of public.orders, mapped onto the table db/migrations creates. */
@Entity({ name: "orders" })
export class OrderEntity {
    @PrimaryColumn({ name: "id", type: "uuid" })
    id!: string

    @Column({ name: "workspace_id", type: "uuid" })
    workspaceId!: string

    @Column({ name: "total_cents", type: "int8" })
    totalCents!: string

    @Column({ name: "status", type: "varchar", length: 32 })
    status!: string

    @Column({ name: "kind", type: "enum", enum: OrderKind, enumName: "order_kind" })
    kind!: OrderKind

    @Column({ name: "note", type: "text", nullable: true })
    note!: string | null

    @Column({ name: "tags", type: "text", array: true })
    tags!: Array<string>

    @Column({ name: "created_at", type: "timestamptz" })
    createdAt!: Date
}
