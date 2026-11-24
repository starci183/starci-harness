"use client"

import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react"
import { createElement as h, useMemo, type ReactElement } from "react"
import { buildEntityNodes, buildSchemaEdges, schemaSizes, type EntityRfNode } from "./build.js"
import { GraphCanvas, type Placement } from "./shared/canvas.js"
import { StepEdge } from "./shared/StepEdge.js"
import { useLayoutDirection } from "./shared/phone.js"
import type { GraphCanvasProps, GraphEdge, SchemaEntity } from "./types.js"

export interface SchemaMapProps extends GraphCanvasProps {
    readonly entities: readonly SchemaEntity[]
    /** A relation between two entities: `source` holds the field that points at `target`. */
    readonly relations: readonly GraphEdge[]
    /** The "+N" row of an entity with more fields than it draws, in the app's words (e.g. `(n) => "+" + n + " fields"`). */
    readonly moreLabel?: (count: number) => string
}

const EntityView = (moreLabel: SchemaMapProps["moreLabel"]) =>
    function EntityNodeView({ data, sourcePosition, targetPosition }: NodeProps<EntityRfNode>): ReactElement {
        const handle = { isConnectable: false, className: "starci-graph-handle" }
        return h(
            "div",
            { className: "starci-graph-entity", "data-selected": data.selected ? "true" : undefined },
            h(Handle, { ...handle, id: "in", type: "target", position: targetPosition ?? Position.Left }),
            h(
                "div",
                { className: "starci-graph-entity-head" },
                data.icon === undefined || data.icon === null ? null : h("span", { className: "starci-graph-node-icon", "aria-hidden": true }, data.icon),
                h(
                    "span",
                    { className: "starci-graph-node-text" },
                    h("span", { className: "starci-graph-node-label" }, data.label),
                    data.description === undefined ? null : h("span", { className: "starci-graph-node-description" }, data.description),
                ),
                data.count === undefined ? null : h("span", { className: "starci-graph-entity-count" }, String(data.count)),
            ),
            data.rows.length === 0
                ? null
                : h(
                      "ul",
                      { className: "starci-graph-entity-fields", "aria-hidden": true },
                      data.rows.map((field) =>
                          h("li", { key: field.id, className: "starci-graph-entity-field" }, h("span", null, field.label), field.type === undefined ? null : h("span", { className: "starci-graph-entity-type" }, field.type)),
                      ),
                      data.more > 0 ? h("li", { key: "more", className: "starci-graph-entity-field starci-graph-entity-more" }, moreLabel === undefined ? `+${String(data.more)}` : moreLabel(data.more)) : null,
                  ),
            h(Handle, { ...handle, id: "out", type: "source", position: sourcePosition ?? Position.Right }),
        )
    }

const EDGE_TYPES = { step: StepEdge }

/**
 * The schema map: a box per entity (its label, description, figure and fields) and an arrow per relation, laid out by ELK like a flow.
 * Read-only; pressing a box selects it and calls `onNodePress`. Render it inside a Grammar `Fragment` with a reason.
 */
export const SchemaMap = (props: SchemaMapProps): ReactElement => {
    const { entities, relations, moreLabel } = props
    const direction = useLayoutDirection(props.direction ?? "LR", "TB")
    const sizes = useMemo(() => schemaSizes(entities), [entities])
    const rfEdges = useMemo(() => buildSchemaEdges(new Set(entities.map((entity) => entity.id)), relations), [entities, relations])
    const nodeTypes = useMemo<NodeTypes>(() => ({ entity: EntityView(moreLabel) }), [moreLabel])
    const makeNodes = useMemo(
        () => (placement: Placement, selectedId: string | null) => buildEntityNodes(entities, placement.positions, direction, selectedId),
        [entities, direction],
    )
    return h(GraphCanvas, { ...props, direction, sizes, links: rfEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, ...(typeof edge.data?.pill === "string" ? { label: edge.data.pill } : {}) })), rfEdges, makeNodes, nodeTypes, edgeTypes: EDGE_TYPES })
}
