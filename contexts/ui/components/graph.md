# Graph: the core's graph ext

`@starci/grammar/core/ext/graph` is part of Grammar core, used ONLY when the reader must see a structure of steps, relations or clusters: a run's flow (`FlowGraph`), a data model (`SchemaMap`, `ErdMap`) or a knowledge map (`KnowledgeMap`). Everything else is core: a list, `Timeline`, `Stepper`, cards ([situations](../situations.md)). The ext imports the core and its tokens; the core entry never imports the ext, so an app that draws no graph installs none of its libraries (`@xyflow/react`, `elkjs`, `d3-force` are optional peers of `@starci/grammar`). An app never imports those libraries itself.

The node graphs of a StarCi front end, over xyflow and in the look of the Grammar: `FlowGraph` draws one workflow run (cards, decision diamonds, loops and groups, with a status on each node and the way the run went on each edge) and `SchemaMap` draws the object types of an app with their fields and the relations between them. Both are laid out by ELK (layered, left to right or top to bottom), so nobody places a node by hand unless the app turns on `editable`; they pan and zoom, open at 100% on the step that matters (never fitted; fitting is the zoom group's fit button), select a node on click, Enter or Space, can show an overview map, and are a skeleton while loading.

They draw only from the tokens of the Grammar theme in the page (`--surface`, `--foreground` (the dot grid of the panel is `--foreground` mixed 22% into `--surface`, quiet but seen in light and dark), `--border`, `--muted`, `--accent*`, `--info`, `--success*`, `--warning*`, `--danger*`, `--default*`, `--grammar-radius-*`, `--grammar-type-*`), so they follow the app's brand and its dark mode. They carry no icon and no text of their own: the icons, the words of the states, the labels of the controls and the legend are the app's.

## Minimal usage (any app)

An order-approval flow in a plain app; every word and icon is the app's:

```tsx
import "@starci/grammar/core/ext/graph.css"
import { FlowGraph, type FlowNode, type GraphEdge } from "@starci/grammar/core/ext/graph"

const nodes: FlowNode[] = [
    { id: "placed", label: "Order placed", status: "done", icon: <BoltIcon /> },
    { id: "limit", label: "Over the limit?", shape: "diamond", status: "done", outputs: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
    { id: "approve", label: "Manager approval", status: "wait", wait: { kind: "person", label: "Needs approval", detail: "waiting for the sales manager" } },
    { id: "ship", label: "Ship the order", icon: <TruckIcon /> },
]
const edges: GraphEdge[] = [
    { source: "placed", target: "limit" },
    { source: "limit", target: "approve", sourcePort: "yes" },
    { source: "approve", target: "ship" },
]

<div style={{ blockSize: "28rem" }}>
    <FlowGraph
        label="Order approval"
        nodes={nodes}
        edges={edges}
        direction="TB"
        statusLabels={{ done: "Done", running: "Running", wait: "Waiting", error: "Failed", skipped: "Skipped", todo: "Not run" }}
        skippedLabel="Skipped"
    />
</div>
```

The package has no words, icons or routes of its own and no default language; the demo (`npm run ext:demo` in packages/grammar) has one neutral example (`order-approval`) and the rest in another language.

## Use it

A graph is a Grammar component, so it needs no `Fragment` (decision 2026-11-22: the ext draws in the Grammar's tokens and primitives, and `starci-fe/fragment-only-library` keeps naming only the raw toolkits). Import the ext's stylesheet once, after the core's; it carries xyflow's base sheet, so an app imports nothing from xyflow. Like every Grammar component, a graph stands inside the app's `GrammarRoot`, whose ramps it reads:

```tsx
import "@starci/grammar/core/ext/graph.css"
import { FlowGraph, type FlowNode, type GraphEdge } from "@starci/grammar/core/ext/graph"

const nodes: FlowNode[] = [
    { id: "start", label: t("start"), status: "done", kind: "event", icon: <PlayIcon /> },
    { id: "paid", label: t("paid"), shape: "diamond", status: "done", outputs: [{ id: "yes", label: t("yes") }, { id: "no", label: t("no") }] },
    { id: "ship", label: t("ship"), status: "running", kind: "action", icon: <TruckIcon /> },
    { id: "remind", label: t("remind"), status: "skipped" },
]
const edges: GraphEdge[] = [
    { source: "start", target: "paid" },
    { source: "paid", target: "ship", sourcePort: "yes", variant: "taken" },
    { source: "paid", target: "remind", sourcePort: "no" }, // an untaken branch: faded, dotted, with skippedLabel
]

<div style={{ blockSize: "28rem" }}>
        <FlowGraph
            label={t("runGraph")}
            nodes={nodes}
            edges={edges}
            isLoading={isLoading}
            statusLabels={{ done: t("done"), running: t("running"), wait: t("wait"), error: t("error"), skipped: t("skipped"), todo: t("todo") }}
            skippedLabel={t("skipped")}
            onNodePress={openStep}
        />
</div>
```

The graph fills its parent, so the parent has a height.

## Built from core

The ext draws nothing core already has (owner 2026-11-22, "ext is built from core"): a node's mark is the core's `IconTile` (its state and the node's own icon), its status the core's `InlineStatus` on the card's top edge, its words core `Text` roles (the name `label.item` 14px, the line under it `label.field` 13px), its chips, tag, ports and the words of an edge core `Badge`s (at the label.field size, 13px: no word of a graph is under 13px), the zoom the core's 40px `IconButton`s (shared by every mode), loading the core's `Skeleton`, a legend's state rows `InlineStatus`, an ERD field's link the core's `Link` after the link icon. The status glyphs are the core's map, never the ext's own. A node's `icon` is an element of an icon component that forwards its props (`<TruckIcon />`, like Heroicons): the core draws that component on the state's plate; any other node is kept as artwork on a neutral plate. What remains the ext's: the canvas, the lines and their markers, the layout, the panel and the boxes that place the core's parts.

## The six states

A node is in exactly one of six states (`status`, `todo` when left out). Every node has a border in its state's tone (diamonds and frames too), and the status is a chip on the card's top edge: a small glyph and the word. The tile is round, 40px, holds the node's own `icon` (a neutral default glyph when it has none, never a state's) on a plate in the state's tone. The words are the app's (`statusLabels`, all six, required): a node is named for assistive technology by `"<label>, <status word>"`.

| state | example word | look |
|---|---|---|
| `done` | Done | success border |
| `running` | Running | info (blue) border, a turning ring on the tile; **the edge into it flows** (moving dots on a solid line, not for a reader who asked for reduced motion) |
| `wait` | Waiting | warning (amber) border; the edge into it is solid amber and **still** (paused, no animation) |
| `error` | Failed | danger border |
| `skipped` | Skipped | muted solid border, faded |
| `todo` | Not run | muted dashed border, the whole card faded |

The older words are still read: `waiting` is `wait`, `failed` is `error`, `idle` is `todo`.

**One active node on a path.** A run has one node running on a path. The app supplies valid states, and the graph draws exactly what it is given; it does not repair them. In development (`NODE_ENV` not `production`) the graph logs one `console.warn` for each pair of running nodes where one lies downstream of the other (`findConcurrentRunning` is the pure check). Two branches may each run.

## FlowGraph

```ts
interface FlowGraphProps extends GraphCanvasProps {
    nodes: readonly FlowNode[]
    edges: readonly GraphEdge[]
    statusLabels: Record<FlowStatus, string>      // done, running, wait, error, skipped, todo
    skippedLabel?: string                         // the words on an untaken branch ("Bỏ qua")
    kindTones?: Partial<Record<FlowKind, GraphTone>>
    legend?: readonly FlowLegendItem[]
    linkComponent?: GraphLinkComponent            // the app's router link for a node with an href
}
```

`GraphCanvasProps` (shared with `SchemaMap`): `label`, `direction` (`LR` default, `TB`), `isLoading`, `emptyLabel`, `selectedId` and `onSelect(id | null)`, `onNodePress(id)`, `focusId` (the node the first view is centred on), `interactive` (default on; `false` is a still picture, fitted, with no zoom group), `showControls`, `minimap` and `minimapLabel`, `ariaLabelConfig`, `editable`, `positions`, `onPositionsChange`, `resetLabel`, `islands`, `islandsWidth`, `className`.

### Nodes

```ts
interface FlowNode {
    id: string; label: string; description?: string
    icon?: ReactNode                 // the tile at the left; a hand-off node shows the icon of the flow it hands over to
    status?: FlowStatusInput
    kind?: "event" | "action" | "condition" | "ask" | "wait" | "end"   // sets the tile's tone; trigger, execute, output are read as event, action, end
    tone?: GraphTone                 // the tile's tone, over the kind's
    shape?: "card" | "diamond"       // a decision diamond holds its label and puts its ports at its vertices
    tag?: string                     // a pill on the card's top-right corner
    outputs?: FlowPort[]             // named output ports { id, label, tone?: "danger" }
    chips?: FlowChip[]               // pills under the title, three at most, the rest "+N"
    agent?: ReactNode; agentName?: string   // a 16px avatar slot and a name
    count?: number | string
    href?: string
    container?: FlowContainer        // makes the node a region that holds childIds
    wait?: { kind: "person" | "time" | "external"; label: string; detail?: string }   // with status wait: the chip word and the line under the title, the app's words
    errorReason?: string             // with status error: a business reason, never a code
    dimmed?: boolean; placeholder?: boolean
}
```

A branch (`kind: "condition"` or a diamond) with no `outputs` takes its ports from the labels of its outgoing edges, in order; the label then stands on the port, not on the line. An edge leaves a port by `sourcePort` (the port id, or a port with the same label).

### Branches draw every branch

A decision draws all of its branches. The branch the run took (`variant: "taken"`) is solid, in the success tone; once one branch is taken, every other branch that has no variant of its own is **skipped**: faded, dotted, with the words `skippedLabel` on it (the words are never fixed in the package). Say `variant: "skipped"` to mark a branch yourself.

### Containers: groups and loops

```ts
interface FlowContainer {
    childIds: string[]
    kind?: "group" | "loop"          // group: a solid box with a header; loop: a dashed frame
    chips?: FlowChip[]
    description?: string             // loop: a muted line after the label
    exits?: FlowPort[]               // loop: the ways out, a pill each on the frame's end edge
    note?: string                    // loop: a muted line inside the bottom
}
```

The children are laid out as a graph of their own inside the box (a container may hold containers). An edge to or from the container's id meets the box; from a loop it may leave by an exit (`sourcePort`). A child stays inside its container when it is dragged.

### Edges

```ts
interface GraphEdge {
    id?: string; source: string; target: string; label?: string
    sourcePort?: string
    variant?: "taken" | "fallback" | "skipped" | "back"
    placeholder?: boolean
}
```

Left to the run, an edge is drawn from the step it leads into (see the line styles below). A variant sets it: `taken` solid success; `fallback` dashed (the road when the awaited thing does not happen); `skipped` faded and dotted; `back` dashed, routed round the outside of both ends (it places nothing). A label is a pill on the line, except a branch's port label.

### The first view, on every screen

A node is the same size on every screen and a person drags the graph by hand: at every width the graph opens at 100% (no fit to the width, no relayout, text never under 13px). A graph that fits its frame at 100% stands in its middle; a larger one is centred on its focus step, held so that its start never stands further in than the inset (the zoom buttons' room on the left, 16px at the top). The focus step is `focusId` when the app names one, else the running step, else a failed one, else a waiting one, else the first not done, else the first (`focusStep`). The view is set once per layout: a status change, a resize or a pan never moves it. One finger pans, two fingers pinch, a double tap zooms in. The zoom buttons are 40px and include fit, the only way the graph is fitted; their words are the app's (`ariaLabelConfig`). Give the graph a fixed height (about 70vh on a phone) so the page still scrolls past it.

### Line styles

| line | meaning |
|---|---|
| solid, in the state tone | a path the run took (`taken`) |
| solid info blue with moving dots | flowing into the running step (not for a reader who asked for reduced motion) |
| solid amber, still | the edge into a waiting step |
| dashed grey | not reached yet |
| dotted, faint | a branch not taken (`skipped`) |
| dashed | `fallback`, `back` |

A container frame is thin, solid and lightly tinted in the tone of its state, never dashed; its state is what its children are (error, running, wait, done, skipped, not run). Each edge starts with a hollow 8px circle centred on the border of its source and ends with a hollow open triangle whose tip touches the border of its target.

### Layout

Top to bottom (`direction: "TB"`) is the layout the owner's spine rules are written for: in at the top centre, out at the bottom centre, a decision's branches at its sides (the first on the left, the second on the right); 48 within a layer, 64 between layers. ELK also gives the route of every edge and the box of every label (measured from the words), and the graph draws from those. A loop's back edge is drawn after the layout, inside its container, in the gutter on its own branch's side.

ELK `layered`, left to right or top to bottom, with ports and containers; edges are orthogonal with rounded corners, a dot where they leave and an arrowhead. **Islands** (parts of the graph with no edge between them) are laid out one by one and packed side by side in rows up to `islandsWidth` (default 1200 graph units); `islands: "stack"` puts them in one column. The layout depends on ids, sizes, ports, edge ends, direction and islands only: a status change neither moves nor refits the graph.

### Editing

Read-only by default. `editable` lets a person drag the nodes; ELK gives the first positions and `positions` (the arrangement the app saved, `{ [id]: { x, y } }`, a child's inside its container) overrides them. `onPositionsChange(positions)` fires when a drag ends with the whole arrangement, and with `{}` when the reset button (in the zoom group, named by `resetLabel`; no label, no button) returns to the automatic layout. Left out, `positions` is kept by the graph itself. A position of an id that is not in the graph is ignored.

### Legend

`legend` draws a row under the canvas; `<FlowLegend items kindTones />` is the same row for a place of your own (under a card). An item is `{ label, kind }` (a step kind, or `loop`; `shape: "diamond"` for a condition), `{ label, status }` or `{ label, edge }` (`taken`, `fallback`, `skipped`, `back`, `running`, `wait`).

### Loading

`isLoading` is a skeleton graph of node-shaped bones and the lines between them, with no text, and `aria-busy`. It is also shown for the moment ELK takes to place a new graph.

## SchemaMap

`SchemaMap` takes `entities` (`{ id, label, description?, count?, icon?, fields?: { id, label, type? }[] }`), `relations` (`{ id?, source, target, label? }`, the `source` entity holds the field that points at the `target`), `moreLabel(n)` for the "+N" row of an entity with more than six fields, and the `GraphCanvasProps`. Its edges never flow.

## ErdMap

The map of the records of an app, for any app: entities, fields and relations, with no word of its own. `ErdMap` takes `entities` (`{ id, label, count?, icon?, fields?: { id, label, type? }[] }`; `icon` is an SVG component of the app's own set, Grammar's `IconSource`, left out the tile shows the first letter), `relations` (`{ id?, source, field?, target, label?, from?, to? }`: the field `field` of `source` points at `target`; `from` and `to` are `{ many?, optional? }`, many at `from` and one at `to` by default), `label`, `onOpen(type)`, `maxFields` (8; the fields a relation starts at always stay), `moreLabel(n)`, `isLoading`, `emptyLabel` and `ariaLabelConfig`. A field a relation starts at shows a link icon and the other entity's name in place of its type. The type words ("text", "number", "money"), the record counts and the words on the lines are all the app's.

```tsx
import "@starci/grammar/core/ext/graph.css"
import { ErdMap, type ErdEntity, type ErdRelation } from "@starci/grammar/core/ext/graph"

const entities: ErdEntity[] = [
    { id: "book", label: "Books", count: "4,120 records", fields: [{ id: "title", label: "Title", type: "text" }, { id: "author", label: "Author" }] },
    { id: "author", label: "Authors", count: "860 records", fields: [{ id: "name", label: "Name", type: "text" }] },
]
const relations: ErdRelation[] = [{ source: "book", field: "author", target: "author", label: "one author, many books" }]

export const Library = () => (
    <ErdMap label="Records" entities={entities} relations={relations} onOpen={(type) => open(type)} />
)
```

The line runs from the field's own port to the head of the other entity, with a crow's foot where many stand and two bars where one stands (a ring beyond either when the end may be empty). Hovering a relation or an entity lights both ends. A link is drawn with an icon, never a typed arrow. On every screen the map opens at 100%: a map that fits stands in the middle of its panel, a larger one at its top-left corner past the controls, or centred on `focusId` (an entity id) when the app names one. A finger drags it, two fingers zoom it, and the 40px controls fit it (the words of the controls are `ariaLabelConfig`); on a phone give the panel about 70vh.
## KnowledgeMap

A map of what an app knows, for any app: topic clusters with names, a bubble for each item sized by its weight, and a line from an item to the item it came from. It is not tied to one product: the data is neutral (clusters, items with a weight, links) and every word is the app's.

```tsx
import { KnowledgeMap } from "@starci/grammar/core/ext/graph"

<KnowledgeMap
    label="Topics"
    clusters={[{ id: "api", name: "API reference" }, { id: "guides", name: "Guides" }]}
    items={[
        { id: "auth", name: "Authentication", kind: "document", clusterId: "api", weight: 70 },
        { id: "keys", name: "Keys go in a header", kind: "fact", clusterId: "api", weight: 38, sourceId: "auth" },
        { id: "hooks", name: "Webhooks", kind: "document", clusterId: "guides", weight: 55 },
    ]}
    zoomLabels={{ zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit to view" }}
    kindLabels={{ document: "Page", fact: "Detail" }}
    weightLabel={(n) => `${n} visits`}
    onOpen={(id) => open(id)}
/>
```

- Layout: a seeded d3-force run (the same input always gives the same positions) on a wide grid of clusters; no two bubbles touch, no two cluster names overlap, and a name keeps 8px from every bubble.
- Look: the shared bordered dot-grid panel, a toolbar of three 40px zoom buttons (in, out, fit), the name card of a bubble on hover or focus (the Grammar Tooltip), `onOpen(id)` on click or Enter, a legend.
- Every screen: the map is the same graph on a phone as on a desktop, at 100% when it opens (no fit-to-width, no list): a map that fits its canvas stands in its middle, a larger one is centred on `focusId` (an item id) or, left out, on the heaviest item. A finger drags it, two fingers pinch it, a double tap zooms in; keep the panel about 70vh tall so the page scrolls past it.
- Words: `kindLabels`, `stateLabels`, `weightLabel`, `sourceLabel`, `zoomLabels`, `emptyLabel` and the `legend` are all passed in; the package has none of its own.

## Look

A card is 280 wide (a card with a column of ports down its end side, 376), radius `--grammar-radius-lg`, a 1.5px border in its state tone. The `icon` is the round 40px tile at its left, on a plate in the soft pair of the state's tone. The label is the Grammar item label role (14 / 500), the description the caption role (12, muted). A selected node has one 2px border in its tone and a soft tint, never a second ring. Every drawn pixel is a hit area: the edges have no wider invisible path, the handles are neither seen nor hit.

## Migrating from an app's own graph

The props of the nivo-lite app's own `FlowGraph` and where each went are in [graph-from-nivo](graph-from-nivo.md).

## Layout and helpers

`layoutFlow(sizedNodes, links, { direction, islands, width })` is the pure layout (ELK `layered`); it returns the top-left corner and the box of each node, rounded to whole pixels, and the same graph always gets the same layout. `layoutGraph` is its positions only. `resolveFlow`, `buildFlowNodes`, `buildFlowEdges`, `buildEntityNodes`, `isEdgeAnimated`, `normalizeStatus`, `statusTone`, `findConcurrentRunning` and the rest are exported for a custom canvas.

`@xyflow/react` and `elkjs` are dependencies; `react` and `react-dom` are peers.

## The demo and the browser proof

`npm run ext:demo` in packages/grammar serves every story (the six states, a decision, a loop, containers, islands, the legend, edge variants, a vertical graph, editing, loading, the schema map) at `http://127.0.0.1:5294/?story=<id> (one server, one port of its own; every mode is a route)`; `npm run ext:e2e` runs the Playwright specs in Chromium at 1440 and 390 wide against it (`GRAPH_SHOTS_DIR` is where the pictures go, `GRAPH_CHROMIUM` names a Chromium to launch). The demo and the specs are not published.
