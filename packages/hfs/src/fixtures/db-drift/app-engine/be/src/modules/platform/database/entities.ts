import { EntitySchema } from "typeorm"

/** The engine's base table, declared as a TypeORM EntitySchema (no class): the drift verb compares its columns like a class entity's. */
export const recordsSchema = new EntitySchema({
  name: "Records",
  tableName: "records",
  columns: {
    entity: { type: "text", primary: true },
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    data: { type: "jsonb" },
    version: { type: "bigint" },
  },
})

/** Every entity source of the app. */
export const entities = [recordsSchema]
