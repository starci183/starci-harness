import type { ErdEntity, ErdField, ErdRelation } from "./types.js"

/** The fixed width of an entity box, and the heights the layout and the stylesheet share. */
export const ERD_WIDTH = 264
export const ERD_HEAD = 64
export const ERD_ROW = 32
export const ERD_MORE = 28
/** The line under the head (1) plus the room above and below the rows (4 each). */
export const ERD_BODY_PAD = 9
export const ERD_DEFAULT_FIELDS = 8

export type ErdSide = "L" | "R"

export interface ErdRow {
    readonly field: ErdField
    /** The label of the entity the field points at, when a relation starts at it. */
    readonly links: string | undefined
    /** The id of that entity. */
    readonly linksTo: string | undefined
}

export interface ErdNode {
    readonly id: string
    readonly entity: ErdEntity
    readonly rows: readonly ErdRow[]
    readonly more: number
    readonly height: number
}

export interface ErdEdge {
    readonly id: string
    readonly source: string
    readonly target: string
    /** The field the line starts at, or `head`. */
    readonly sourcePort: string
    readonly label: string | undefined
    readonly fromMany: boolean
    readonly fromOptional: boolean
    readonly toMany: boolean
    readonly toOptional: boolean
}

export interface ErdModel {
    readonly nodes: readonly ErdNode[]
    readonly edges: readonly ErdEdge[]
}

export const HEAD_PORT = "head"

/** The id of a port as the layout and the handles know it: the row (a field id or `head`) and the side of the box. */
export const erdPortId = (node: string, row: string, side: ErdSide): string => `${node}::${row}::${side}`

/** The height of an entity box from the rows it draws and the "+N" row. */
export const erdHeight = (rows: number, more: number): number => (rows + more === 0 ? ERD_HEAD : ERD_HEAD + ERD_BODY_PAD + rows * ERD_ROW + (more > 0 ? ERD_MORE : 0))

/** The y of a port inside its box: the middle of the head, or of the row with that index. */
export const erdPortY = (row: number | typeof HEAD_PORT): number => (row === HEAD_PORT ? ERD_HEAD / 2 : ERD_HEAD + 1 + 4 + row * ERD_ROW + ERD_ROW / 2)

/** The rows an entity draws: every field a relation starts at, then the others in order up to `max`; the order of the fields is kept. */
const visibleRows = (entity: ErdEntity, linked: ReadonlyMap<string, { readonly id: string; readonly label: string }>, max: number): { readonly rows: readonly ErdRow[]; readonly more: number } => {
    const fields = entity.fields ?? []
    const capacity = Math.max(max, linked.size)
    const keep = new Set<string>()
    for (const field of fields) if (linked.has(field.id)) keep.add(field.id)
    for (const field of fields) if (keep.size < capacity) keep.add(field.id)
    const rows = fields.filter((field) => keep.has(field.id)).map((field) => ({ field, links: linked.get(field.id)?.label, linksTo: linked.get(field.id)?.id }))
    return { rows, more: fields.length - rows.length }
}

/** The entities and relations the map can draw: unknown ends are dropped, a repeated relation is drawn once, and the ids of the relations are made. */
export const resolveErd = (entities: readonly ErdEntity[], relations: readonly ErdRelation[], max: number = ERD_DEFAULT_FIELDS): ErdModel => {
    const byId = new Map<string, ErdEntity>()
    for (const entity of entities) if (!byId.has(entity.id)) byId.set(entity.id, entity)
    const seen = new Set<string>()
    const edges: ErdEdge[] = []
    for (const relation of relations) {
        const holder = byId.get(relation.source)
        const other = byId.get(relation.target)
        if (holder === undefined || other === undefined) continue
        if (relation.source === relation.target && relation.field === undefined) continue
        const field = relation.field !== undefined && (holder.fields ?? []).some((candidate) => candidate.id === relation.field) ? relation.field : HEAD_PORT
        const key = `${relation.source}:${field}->${relation.target}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({
            id: relation.id ?? `${relation.source}.${field}>${relation.target}`,
            source: relation.source,
            target: relation.target,
            sourcePort: field,
            label: relation.label === undefined || relation.label === "" ? undefined : relation.label,
            fromMany: relation.from?.many ?? true,
            fromOptional: relation.from?.optional ?? false,
            toMany: relation.to?.many ?? false,
            toOptional: relation.to?.optional ?? false,
        })
    }
    const nodes = [...byId.values()].map((entity) => {
        const linked = new Map<string, { readonly id: string; readonly label: string }>()
        for (const edge of edges) if (edge.source === entity.id && edge.sourcePort !== HEAD_PORT) linked.set(edge.sourcePort, { id: edge.target, label: byId.get(edge.target)?.label ?? "" })
        const { rows, more } = visibleRows(entity, linked, max)
        return { id: entity.id, entity, rows, more, height: erdHeight(rows.length, more) }
    })
    return { nodes, edges }
}

/** A key that changes when the layout has to be made again: ids, rows and relations; never a word other than a relation's label. */
export const erdStructureKey = (model: ErdModel): string =>
    JSON.stringify([model.nodes.map((node) => [node.id, node.rows.map((row) => row.field.id), node.more > 0]), model.edges.map((edge) => [edge.id, edge.source, edge.sourcePort, edge.target, edge.label ?? ""])])
