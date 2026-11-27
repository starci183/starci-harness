# Graph: the core's graph ext

`@starci/grammar/core/ext/graph` is part of Grammar core, used ONLY when the reader must see a structure of steps, relations or clusters: a run's flow (`FlowGraph`), a data model (`SchemaMap`, `ErdMap`) or a knowledge map (`KnowledgeMap`). Everything else is core: a list, `Timeline`, `Stepper`, cards ([situations](../situations.md)). The ext imports the core and its tokens; the core entry never imports the ext, so an app that draws no graph installs none of its libraries (`@xyflow/react`, `elkjs`, `d3-force` are optional peers of `@starci/grammar`). An app never imports those libraries itself.

The node graphs of a StarCi front end, over xyflow and in the look of the Grammar: `FlowGraph` draws one workflow run (cards, decision diamonds, loops and groups, with a status on each node and the way the run went on each edge) and `SchemaMap` draws the object types of an app with their fields and the relations between them. A flow is laid out on its spine (the spine layout, below) and a schema map by ELK (layered, left to right or top to bottom), so nobody places a node by hand unless the app turns on `editable`; they pan and zoom, open fitted (the whole graph, centred, at 100% or less), lay out top-down on a phone, select a node on click, Enter or Space, can show an overview map, and are a skeleton while loading.

They draw only from the tokens of the Grammar theme in the page (`--surface`, `--foreground` (the dot grid of the panel is `--foreground` mixed 22% into `--surface`, quiet but seen in light and dark), `--border`, `--muted`, `--accent*`, `--info`, `--success*`, `--warning*`, `--danger*`, `--default*`, `--grammar-radius-*`, `--grammar-type-*`), so they follow the app's brand and its dark mode. They carry no icon and no text of their own: the icons, the words of the states, the labels of the controls and the legend are the app's.

## Minimal usage (any app)

An order-approval flow in a plain app; every word and icon is the app's:

```tsx
// globals.css, after the Grammar stylesheet: @import "@starci/grammar/core/ext/graph.css";
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

A graph is a Grammar component, so it needs no `Fragment` (the ext draws in the Grammar's tokens and primitives, and `starci-fe/fragment-only-library` keeps naming only the raw toolkits). Import the ext's stylesheet once, after the core's (in an app, in `globals.css` right after the Grammar stylesheet, [FE-CSS-2](../../code/fe/ui.md#fe-css-2-globalscss-imports-in-the-cascade-order); R93 accepts an exported `core/ext/<name>.css` there, and the ext's code entry `@starci/grammar/core/ext/graph` in product source); it carries xyflow's base sheet, so an app imports nothing from xyflow. Like every Grammar component, a graph stands inside the app's `GrammarRoot`, whose ramps it reads:

```tsx
// globals.css, after the Grammar stylesheet: @import "@starci/grammar/core/ext/graph.css";
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

The graph fills its parent, so the parent has a height (`height="frame"`, the default). A top-down flow in a wide column takes `height="content"` instead and its parent gives it no height: the graph is as tall as its drawing at 100% plus the fit insets, at least 20rem and at most `--starci-graph-max-block-size` (80vh), so it opens at full size rather than shrinking into a fixed height.

## Built from core

The ext draws nothing core already has: a node's mark is the core's `IconTile` (its state and the node's own icon), its status the core's `InlineStatus` on the card's top edge, its words core `Text` roles (the name `label.item` 14px, the line under it `label.field` 13px), its chips, tag, ports and the words of an edge core `Badge`s (at the label.field size, 13px: no word of a graph is under 13px), the zoom the core's 40px `IconButton`s (shared by every mode), loading the core's `Skeleton`, a legend's state rows `InlineStatus`, an ERD field's link the core's `Link` after the link icon. The status glyphs are the core's map, never the ext's own. A node's `icon` is an element of an icon component that forwards its props (`<TruckIcon />`, like Heroicons): the core draws that component on the state's plate; any other node is kept as artwork on a neutral plate. What remains the ext's: the canvas, the lines and their markers, the layout, the panel and the boxes that place the core's parts.

## The six states

A node is in exactly one of six states (`status`, `todo` when left out). Every node has a border in its state's tone (diamonds and frames too), and the status is a chip on the card's top edge: a small glyph and the word. The tile is round, 40px, holds the node's own `icon` (a neutral default glyph when it has none, never a state's) on a plate in the state's tone. The words are the app's (`statusLabels`, all six, required): a node is named for assistive technology by `"<label>, <status word>"`.

| state | example word | look |
|---|---|---|
| `done` | Done | success border |
| `running` | Running | success (green) border, a turning ring on the tile (done is green too, the glyph tells them apart); **the edge into it flows** (moving dots on a solid line, not for a reader who asked for reduced motion) |
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
    layout?: "spine" | "layered"                  // default spine (see "The spine layout"); layered is ELK's, LR or TB
    onNodeOpen?: (id: string) => void             // a step was opened (click, Enter, Space): the app opens its FlowStepDrawer
    collapse?: { label: (count: number) => string; above?: number }   // fold untaken side roads of a long flow behind "+N steps" pills
}
```

`GraphCanvasProps` (shared with `SchemaMap`): `label`, `direction` (`LR` default, `TB`), `isLoading`, `emptyLabel`, `selectedId` and `onSelect(id | null)`, `onNodePress(id)`, `focusId` (the node the first view is centred on when even the least fitted zoom cannot show the whole graph), `interactive` (default on; `false` is a still picture, fitted, with no zoom group), `showControls`, `minimap` and `minimapLabel`, `ariaLabelConfig`, `editable`, `positions`, `onPositionsChange`, `resetLabel`, `islands`, `islandsWidth`, `className`.

### Nodes

```ts
interface FlowNode {
    id: string; label: string; description?: string
    icon?: ReactNode                 // the tile at the left; a hand-off node shows the icon of the flow it hands over to
    status?: FlowStatusInput
    kind?: "event" | "action" | "condition" | "switch" | "ask" | "wait" | "parallel" | "call" | "end"   // sets the tile's tone and, on the spine, the shape; trigger, execute, output are read as event, action, end
    tone?: GraphTone                 // the tile's tone, over the kind's
    shape?: "card" | "diamond" | "hexagon" | "pill" | "stadium" | "rect" | "call"   // left out on the spine, read from the kind (below)
    tag?: string                     // a pill on the card's top-right corner
    outputs?: FlowPort[]             // named output ports { id, label, tone?: "danger", isDefault?: boolean }
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
    kind?: "ok" | "yes" | "no" | "loop" | "timeout" | "refused" | "declined" | "parallel"   // GraphEdgeKind, GRAPH_EDGE_KINDS
    placeholder?: boolean
}
```

An edge carries two things. Its **run** says how far the run went: left to the run, an edge is drawn from the step it leads into (see the line styles below), and a variant sets it: `taken` the run went this way; `fallback` the road when the awaited thing does not happen; `skipped` not taken; `back` returns to an earlier step. Its **kind** says which road it is, and sets its look and, on the spine, the sides it attaches to (`GraphEdgeKind`):

| kind | the road | look | leaves by | enters by |
|---|---|---|---|---|
| `ok` | the plain next step | solid, neutral | bottom-mid | top-mid |
| `yes` | the main answer of a decision | solid success green, stronger | bottom-mid | top-mid |
| `no` | the other answer of a decision | grey dots | right-mid | top-mid |
| `loop` | back to an earlier step | accent dashes, its words after the loop mark (`LOOP_MARK`, ↻), the mark alone when it has none | left-mid | left-mid |
| `timeout` | a wait ran out | round amber dots | right-mid | top-mid |
| `refused`, `declined` | a person or a service said no | thin red dashes | right-mid | top-mid |
| `parallel` | one of the branches that run at once | solid, neutral, from a fork bar | bottom-mid | top-mid |
| `case` | one case of a switch | solid, neutral, from the switch's hollow split bar; the case the run took bold, its words after a check (`CHECK_MARK`) | bottom-mid | top-mid |
| `default` | the switch's case when none matches (its port's `isDefault`) | grey dots, the rightmost column | bottom-mid | top-mid |

Left out, the kind is read from the edge (`edgeKindOf`): `variant: "back"` is `loop`, `variant: "fallback"` is `timeout`, a decision's first port `yes` and its others `no`, out of a switch `case` (its `isDefault` port `default`), two or more plain edges out of a step that is not a decision `parallel`, anything else `ok`; so a graph written before kinds keeps working and gains the looks. The run still shows over the kind: an edge into the running step flows green, one into a waiting step is still amber, one the run has not reached or did not take fades in its own kind's look. The words of an edge are a pill in the tone of its kind (`yes` success, `loop` accent, `timeout` warning, `refused` and `declined` danger), quiet while the run has not reached it. On the spine a port's label stands on its edge, never as a pill inside the card.

### The first view, on every screen

A flow on its spine opens at its readable size, never smaller: it fits the frame's **width** (a tall flow runs on below, panned from its focus step) and never goes under `FLOW_READABLE_ZOOM` (0.75, a card at least 210 wide), on the first view and on the fit button alike (`leastZoom`, `fitWidth` of the canvas, `OpenFit` of `openView`); a longer or wider flow is panned, never shrunk until its words cannot be read. The rest of this section is the other graphs' and the `layered` layout's.

### Folding a long flow

`collapse` folds a flow with more steps than `above` (default 20, `DEFAULT_FOLD_ABOVE`): the spine (the longest run of main edges from a start), every step the run reached (done, running, waiting, failed), every container and every start stay drawn, and each other road off a kept step hangs behind one pill on the edge into it, its words `label(n)` ("+N steps", the app's), its steps and their edges out of the drawing (`foldFlow`, pill ids `FOLD_PREFIX`). Pressing a pill unfolds that road and keeps it open. A run view that passes the workflow's own edges (the branches and loops the run did not take, with their kinds) draws them as edges and folds what is long; it never folds a branch into a card's text.

The first view and the phone are the routing law's rule 4 (below): every graph opens fitted, the whole of it in view and centred inside the insets (the zoom buttons' room on the left, 16px elsewhere), at 100% or less, never enlarged; only a graph that would need less than `LEAST_FIT` (0.1) opens at that zoom, centred on its focus step (`focusId` when the app names one, else the running step, a failed one, a waiting one, the first not done, the first; `focusStep`). Under 480px a `FlowGraph` or `SchemaMap` is laid out top-down (`TB`) whatever `direction` says, so it fits the width. The view is set once per layout: a status change or a pan never moves it. One finger pans, two fingers pinch, a double tap zooms in. The zoom buttons are 40px (zoom in, zoom out, fit); their words are the app's (`ariaLabelConfig`). Give the graph a fixed height (about 70vh on a phone) so the page still scrolls past it.

### Line styles

| line | meaning |
|---|---|
| solid, in the state tone | a path the run took (`taken`) |
| solid success green with moving dots | flowing into the running step (not for a reader who asked for reduced motion) |
| solid amber, still | the edge into a waiting step |
| dashed grey | not reached yet |
| dotted, faint | a branch not taken (`skipped`) |
| dashed | `fallback`, `back` |

Over these, each edge kind keeps its own line (the table under Edges): the run sets the tone of `running` and `wait` and fades what was not reached or taken; the kind sets the line of everything else.

A container frame is thin, solid and lightly tinted in the tone of its state, never dashed; its state is what its children are (error, running, wait, done, skipped, not run). Each edge starts with a hollow 8px circle centred on the border of its source and ends with a hollow open triangle whose tip touches the border of its target.

### The spine layout

The default (`layout: "spine"`, `layoutSpine` in `spine.ts`, its numbers `SPINE`), always top to bottom (`direction` is not read):

1. **The spine is one straight column.** The longest path from the start to an end along `ok`, `yes` and `parallel` edges stands in one column, every node on it centred on one x (of equal paths, the middle one). Side roads stand in columns to its right, at `x = spine + lane * (NODE_WIDTH + columnGap)` (`COLUMN_PITCH`, 360); a road keeps its column down to where it meets the spine again, and the next free column to the right is taken when one is held. The branches of a parallel fork split evenly round their fork, `lane = i - (n - 1) / 2`, and so do several starts that all lead into one step. One layer is one row: its nodes share one centre y, `rowGap` (72) apart, more when a gap carries several runs.
2. **Edges attach only at the middles of the sides, with the fewest bends.** A node has four ports: IN at the top-mid (a forward edge) and the left-mid (a loop); OUT at the bottom-mid (the main road), the right-mid (a side road) and the left-mid (a loop). A main road in one column is straight (0 bends). A side road (`no`, `timeout`, `refused`, `declined`) leaves the right-mid, runs across its own row to the target's column and drops into its top-mid (1 bend); where a node or a frame stands in that way it steps out, drops to the gap above the target and runs across there. A road that meets the spine again drops from its bottom-mid to the gap above its target and runs across (1 bend). A loop leaves the left-mid, runs out to a lane on the left of every node it passes, up, and into its target's left-mid (a U, 2 bends); loops that cross one span take lanes `edgeSpacing` (14) apart, the shorter inside. A fork's branches leave a bar under the fork and drop straight into their targets (0 bends each). Every horizontal run lies in the gap between two rows or on its source's own row, never across a node; runs that share a gap stand `edgeSpacing` apart.
3. **One drawn segment per port.** Two forward edges into one node meet at a merge point, a dot in the gap right above its centre: the edge already in its column runs straight through and carries the one arrow into the top-mid, the other ends at the dot. Three or more (and the branches of a parallel join) drop straight down their own columns, whatever their layer, into a merge bar in the gap right above the target, spanning its leftmost to its rightmost source column and the target's own (centred on the target when the sources stand round it; never a stub out to where no edge drops); each keeps its kind's look on its own drop, and the bar and its one arrow from the middle into the top-mid are neutral (`Bar`, a node of type `bar`, never pressed). A source whose column is blocked below (a spine step with a side road into the bar) steps out of its right-mid to the first free column and drops there. Loops into one node gather in its left lane into one stroke into its left-mid: the longest carries the arrow, the others join it at a dot.
4. **Shapes from kinds.** A step with no `shape` takes its kind's (`shapeOf`): an action a rounded card; an if (a `condition` with two outputs) a diamond, yes out of its bottom vertex and no out of its right one; a switch (`switch`, or a `condition` with three or more outputs) a flat hexagon with its `count` as a badge (the app's words, "3 ways"), one exit at its bottom-mid into a thin hollow split bar, each case dropping straight down its own column in the order given with its words on its drop, the default rightmost; a wait a pill with a clock when it has no icon of its own; an end a stadium; a `parallel` step a square-cornered rectangle with solid fork and join bars; a `call` (a step that runs another workflow) a hexagon with a dashed outline; a loop the dashed frame. Every shape keeps its ports at the middles of its box's sides. The `layered` layout draws a card unless the shape is named.
5. **Frames.** A loop or a group is a frame round its children's box, its loops' lanes and their words, with its header (`description`, "up to 3 rounds") above its first row and its foot below its last; a step that follows the frame stands below it, and a node outside it never stands in its columns. An edge into the frame enters its top over its first step's column; an edge out of it leaves its bottom over its last step's column.
6. **Words beside the first segment, never on a bend.** Right of a line that leaves downwards, above one that leaves sideways (after the drop of a sibling that shares the run); a first segment too short for them hands them to the next. A fork's branch and a switch's case carry theirs on their own drop from the bar. A loop's words stand left of its lane.

The spine layout is plain code over the layers, the lanes and the gaps, not ELK: ELK's layered placement holds no column grid and its router puts ports anywhere along a side and bends past the budget, so the coordinates are computed (the same graph, the same whole pixels). Known gap: a frame's columns are kept free of outside nodes after the lanes are chosen (an outside node moves past the frame's last column), so a crowded graph beside a wide frame can stand one column further out than it needs; and a side road that must step out of a blocked row takes 3 bends.

### Layout (`layout: "layered"`)

One ELK `layered` run places every node and routes every edge (`layoutLayered`, `layered.ts`; owner 2026-11-27: "nothing overlaps"); nothing is moved or re-routed by hand afterwards, so ELK's guarantees hold on the drawing. The other graphs (the lesson `MermaidDiagram`) keep `layoutFlow` and its routing law below.

0. **Edge ends (owner 2026-11-27).** An edge leaves and enters a node only at the middle of one of its four sides: out at the end side, in at the start side, a back edge out of and into the side under the row. A control step (rows) is the one exception: each row has its own port on the end side at the row's middle. The start is a hollow dot (surface fill, the line's colour and width) centred on the border; the end is an open V (`M1 1 L11 6 L1 11`, no fill, round joins, the line's colour and width) whose drawn point touches the target's border, never inside it, never short.
1. **Ports in row order.** Each output port of a card (a branch row of an if, a switch, a loop or a parallel step; the handle `port:<id>` the card renders) is its own ELK port on the end side, in row order (`FIXED_POS`, else `FIXED_ORDER`); a card is entered by one entry port. **Measured, not guessed:** once the cards are drawn the canvas reads every handle's centre back (xyflow's handle bounds) and, when a port stands more than 1px off where the layout put it, lays the graph out once more with the measured ports (`GraphCanvas` `portOf`), so an edge leaves exactly from its row's dot.
2. **Orthogonal, spaced, never through a node** (`LAYERED_SPACING`): 40 within a layer, 72 between layers, 20 between an edge and a node, 12 between parallel edges.
3. **Words placed by the layout, or dropped.** An edge that leaves a card's row carries no words (the row names the branch, and the card dims the row the run did not take). Any other edge's words are an ELK centre label with a box of its own in the layer gap: no line or node runs through it. The room reserved is the structure's words (the loop mark, a case's check, the skipped words a branch may get), never the run's, so a run update never moves the graph.
4. **Notes off the lines.** Words longer than `NOTE_CHARS` (24, a branch's name) are a note (a refusal's reason, "Bị từ chối: ..."): the step's status or its drawer says it, never a pill on a line.
5. **Parallel edges are one line** (`mergeParallel`): the edges that leave one port for one target (an action's "xong", "không duyệt" and "bị từ chối" that all go on to the same step) are drawn once, in the strongest state of the group (a taken one wins), with the first edge's id and their words when they are at most two short names ("có sự kiện · quá hạn"), else none.
6. **Back edges round the outside, dashed.** A loop's body returning to its head or a wait's retry is given to ELK last, flagged back; ELK breaks the cycle there and routes it round the nodes in a lane of its own (`feedbackEdges`).
7. **A step graph is compact** (`density: "steps"`, the owner's approved canvas 2026-11-27; `FlowGraph` picks it when every node is a step card, NIVO's canvas passes it): `LAYERED_STEP_SPACING`, 22 between two columns (a 196 card, so a column every 218), 40 within a column, 6 between an edge and a node, 5 between parallel edges; Brandes-Koepf placement, balanced, so the main road is ONE row (every centre on one line, every wire a straight run between two side midpoints) and a branch's other ways stack above and below it; and no words on any wire (a branch's meaning is its card's row and its colour, the wire legend says the colours). The start node reports the same size as the cards.
8. **Deterministic.** A fixed seed and the model order: the same nodes, sizes, ports and edges give the same layout, and the canvas runs it again only when that structure changes. Disconnected parts are packed by ELK (48 apart).

`findOverlaps(sizes, links, layout)` lists every overlap of a laid-out drawing (node on node, edge through a node, label on a node, a line or a label, two edges along one line unless they share a port); the demo stories `nivo-deposit`, `nivo-deposit-run` and `nivo-multi-post` (two real NIVO workflows) put it on `window.graphOverlaps`, empty.

### Opening a step

`onNodeOpen(id)` fires when a step is opened (click, Enter or Space; with `onNodePress`, never for a bar): the app opens `FlowStepDrawer`, never a rail of its own beside the graph. It is the core's `Drawer`, on the right, `wide`: the step's name, its version badge (`version`, "v2.1") and state (`status`), then its parts in one fixed order (`FLOW_STEP_PARTS`): `in` (Data in), `code` (the code that ran), `mutation` (what it wrote into the run's state), `out` (Data out), `state` (the state the whole run shares). Each part is a titled `Section` with the app's title and the app's blocks (a `CodeBlock`, a key-value list); a part the app does not have is left out. The Grammar lays the parts out; the app fills them.

```tsx
const [open, setOpen] = useState<string | null>(null)
<FlowGraph {...graph} onNodeOpen={setOpen} />
<FlowStepDrawer isOpen={open !== null} onOpenChange={(isOpen) => { if (!isOpen) setOpen(null) }} title={step.label} version={step.version}
    status={{ state: step.status, label: words[step.status] }} closeLabel={t("close")}
    sections={[{ part: "in", title: t("dataIn"), children: <CodeBlock code={json(step.input)} language="json" /> }, /* code, mutation, out, state */]} />
```

### Editing

Read-only by default. `editable` lets a person drag the nodes; ELK gives the first positions and `positions` (the arrangement the app saved, `{ [id]: { x, y } }`, a child's inside its container) overrides them. `onPositionsChange(positions)` fires when a drag ends with the whole arrangement, and with `{}` when the reset button (in the zoom group, named by `resetLabel`; no label, no button) returns to the automatic layout. Left out, `positions` is kept by the graph itself. A position of an id that is not in the graph is ignored.

### Legend

`legend` draws a row under the canvas; `<FlowLegend items kindTones />` is the same row for a place of your own (under a card). An item is `{ label, kind }` (a step kind, or `loop`; `shape: "diamond"` for a condition), `{ label, status }` or `{ label, edge }` (a run style: `taken`, `fallback`, `skipped`, `back`, `running`, `wait`; or an edge kind: `ok`, `yes`, `no`, `loop`, `timeout`, `refused`, `declined`, `parallel`).

### Loading

`isLoading` is a skeleton graph of node-shaped bones and the lines between them, with no text, and `aria-busy`. It is also shown for the moment ELK takes to place a new graph.

## StepCard: the inside of a workflow step card

`StepCard` (0.64.2, the owner's node design 2026-11-27) is the card of one step of a workflow graph, for a canvas that draws its own nodes (NIVO's
`steps` graph): the canvas keeps the border, the selection, the run status on the border and the handles; the card draws everything inside.

- **One size** (0.64.7, the approved canvas). Every card is `STEP_CARD.width` (196) wide and `STEP_CARD.height` (96) tall, the start node too; a control
  step is its 40px head (`STEP_CARD.head`) plus one 32px row per way out (`stepCardHeight(rows)`: a switch of three is 136), never under 96.
- **Content.** The head is the kind's tile beside a small muted kind line (`kindLabel`, the app's words: "Hành động", "AI", "Chờ sự kiện", "Kết thúc")
  over the name; one muted line under the head says what the step does (`subtitle`). A control step's head is its name over its subtitle ("Rẽ nhánh · 3
  đường") with no kind line.
- **Start node.** `kind: "trigger"` draws a danger ring and lists `triggers` (`StepCardTrigger`: words and an optional glyph) one per line under its
  name, whole and wrapping, never cut.
- **Kind.** `kind` is `trigger`, `action`, `ai`, `wait`, `branch`, `approval`, `code`, `end`, `loop`, `parallel` or `join`: its glyph
  (`STEP_CARD_GLYPHS`, or the app's `icon`) on its tinted tile (`STEP_CARD_KIND_TONE`), the name on one line, a muted `subtitle`.
- **Mode badge**, bottom-right (in the head's corner on a control step): `auto` none, `ask` amber, `studio` purple (the graph's own
  `--starci-graph-studio*` pair: HeroUI has no purple), `manual` grey; the words are the app's `modeLabels`.
- **Rows.** A `branch` (an if: exactly two rows; a switch: three or more, the last the "else"), a `loop` (three: the body, its stop
  condition, its limit; the subtitle says "vòng k/N" in a run) and a `parallel` (one row per branch) list their ways out. Each row is 8px by 12px
  (the spacing scale has no 14), a 0.5px seam above it, the first row too, its words, and its own port on the right edge at the row's middle: a 10px
  hollow dot ringed in the row's tone, its centre on the border (the dot the row's wire starts from), holding the app's handle passed by
  `renderPort(row, index)`. The tone sets the dot and the row's edge (`STEP_CARD_EDGE`, `STEP_CARD_DASH`): `main` solid green,
  `warning` solid amber, `else` grey dashes, `back` (a loop's body, which returns) red dashes, `stop` green, `branch` neutral.
- **Replay.** `row.state`: `taken` lights the row in its tone, `dimmed` fades it; `done`, `running` and `error` show a parallel branch's own
  `InlineStatus` with the app's `stateLabel`.

- **Wire** (`StepWire`, 0.64.7, "Bổ sung 3"): the one look of a step graph's wire for a canvas that draws its own edges: the rounded orthogonal line from
  `points` (side midpoint to side midpoint), a hollow start dot (`WIRE.dot`) centred on the source's border, an open V (`WIRE.arrow`, stroke only, the
  wire's colour and width) whose point touches the target's border; `tone` is the row's (`STEP_CARD_EDGE`), `run` `taken` green or `untaken` faded. No
  words on a wire. `WireLegend` (`items`: a tone and the app's word) is the small legend of those colours at the bottom right inside the frame, drawn
  only for a graph with a control step.
- **Zoom bar** (`ZoomBar`, 0.64.7): one row at the bottom left inside the frame, "+", "−" and the fit button that names the zoom ("Vừa khung · 76%"),
  every part whole; it reads xyflow's store, so it stands inside the `ReactFlow`.

In `FlowGraph`, a node's `card` (`FlowStepCard`: `kind`, `kindLabel`, `subtitle`, `triggers`, `mode`, `modeLabels`, `rows`) draws its inside as the
same `StepCard`; a graph whose every node is a card is laid out compact (`density: "steps"`).

Stories `Graph/Step card (0.64.7)`: `Kinds`, `Branches`, `LoopAndParallel`, `Replay`, `InFlowGraph`, `CanvasCards`, `Wires`, `CanvasGraph`.

## SchemaMap

`SchemaMap` takes `entities` (`{ id, label, description?, count?, icon?, fields?: { id, label, type? }[] }`), `relations` (`{ id?, source, target, label? }`, the `source` entity holds the field that points at the `target`), `moreLabel(n)` for the "+N" row of an entity with more than six fields, and the `GraphCanvasProps`. Its edges never flow.

## ErdMap

The map of the records of an app, for any app: entities, fields and relations, with no word of its own. `ErdMap` takes `entities` (`{ id, label, count?, icon?, fields?: { id, label, type? }[] }`; `icon` is an SVG component of the app's own set, Grammar's `IconSource`, left out the tile shows the first letter), `relations` (`{ id?, source, field?, target, label?, from?, to? }`: the field `field` of `source` points at `target`; `from` and `to` are `{ many?, optional? }`, many at `from` and one at `to` by default), `label`, `onOpen(type)`, `maxFields` (8; the fields a relation starts at always stay), `moreLabel(n)`, `isLoading`, `emptyLabel` and `ariaLabelConfig`. A field a relation starts at shows a link icon and the other entity's name in place of its type. The type words ("text", "number", "money"), the record counts and the words on the lines are all the app's.

**Files and selection.** A field that holds files carries `file: { kind, many? }` (`image`, `video`, `audio`, `document`, `file`): its row draws the kind's glyph (`FILE_GLYPHS`, the same the `MediaGrid` draws) before its type words and stays drawn past `maxFields`. With `onOpenField(entity, field)` the name of a file field is a button that opens the field's files (the box still opens the entity). `selectedId` and `selectedField` draw the entity and row the page shows in the selection tone, the map's one accent.

```tsx
// globals.css, after the Grammar stylesheet: @import "@starci/grammar/core/ext/graph.css";
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

The line runs from the field's own port to the head of the other entity, with a crow's foot where many stand and two bars where one stands (a ring beyond either when the end may be empty). Hovering a relation or an entity lights both ends. A link is drawn with an icon, never a typed arrow. On every screen the map opens fitted (the routing law, rule 4): the whole map, centred, at 100% or less. A finger drags it, two fingers zoom it, and the 40px controls fit it (the words of the controls are `ariaLabelConfig`); on a phone give the panel about 70vh.
## KnowledgeMap

A map of what an app knows, for any app: topic clusters with names, a bubble for each item sized by its weight, a line from an item to the item it came from, and a line for each `links` pair of related items (`{ from, to }`; every pair drawn once, whichever way or however often it is given). It is not tied to one product: the data is neutral (clusters, items with a weight, links) and every word is the app's.

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

- Layout: a seeded d3-force run (the same input always gives the same positions) on a wide grid of clusters (each column as wide as its widest cluster or cluster name; on a phone, under 480px, at most two clusters across, laid out top-down), a link pulling its two ends together; no two bubbles touch, no two cluster names overlap, and a name keeps 8px from every bubble.
- Look: the shared bordered dot-grid panel, a toolbar of three 40px zoom buttons (in, out, fit), the name card of a bubble on hover or focus (the Grammar Tooltip), `onOpen(id)` on click or Enter, a legend.
- Every screen: the map is the same graph on a phone as on a desktop, fitted when it opens (the routing law, rule 4): the whole map, centred, at 100% or less (no list), never under the readable zoom (`READABLE_ZOOM`, 0.85): a map that needs less opens at 0.85 from its top, centred across when it fits the width, and the reader pans on. A finger drags it, two fingers pinch it, a double tap zooms in; keep the panel about 70vh tall so the page scrolls past it.
- Words: `kindLabels`, `stateLabels`, `weightLabel`, `sourceLabel`, `zoomLabels`, `emptyLabel` and the `legend` are all passed in; the package has none of its own.

## The routing law

Owner decisions (rules 1 to 6), for every graph of the ext (`FlowGraph`, `SchemaMap`, `ErdMap`, `KnowledgeMap` and the lesson `MermaidDiagram`): an edge reads at a glance. A `FlowGraph` on its spine (the default) holds rules 1, 2, 3 and 6 in their spine form, "The spine layout" items 2 and 3: four midpoint ports, the bend budget, merge dots and bars in place of junctions; the ELK wording below is the `layered` layout's and the other graphs'.

1. **No handle dots, one entry.** A read-only graph shows no dot where an edge leaves (only an `editable` graph does). Edges without a named port touch a node at one
   point per side (ELK `mergeEdges`); every edge enters its target by the side facing the flow, and leaves its source by the side facing its target, never from two
   stacked handles.
2. **Straight or one bend.** Nodes on one rank line (their boxes overlap across the flow, or their centres stand within `STRAIGHT_SNAP`, 8) are joined by one straight
   run; offset nodes by exactly one orthogonal bend: out of the source's side facing the target, round one corner, into the target's flow-facing side. No micro-jog.
   ELK lays out with `NETWORK_SIMPLEX` node placement, which keeps the spine on one line. The one-bend route is taken only where it crosses no node; otherwise
   ELK's orthogonal route (round the nodes) is kept. Owner: `simplifyRoutes` in `layout.ts`.
3. **A decision's main branch runs straight on.** The first branch of a decision leaves by the vertex on the flow's side (`SOUTH` top-down, `EAST` across) and its target
   stands on the decision's line (`alignDecisions` in `arrange.ts`); the other branches leave by the side vertices and turn to the side. Every branch carries its words
   right at the split, at its own vertex: on the first run it does not share with a sibling, clear of the sibling's words, never two answers side by side on one stub.
   A branch on a side vertex runs straight only when its vertex stands inside its target's span; otherwise it turns round to its target, never dropping past it.
   A decision with three or more answers (a lesson `MermaidDiagram` switch) fans its exits left to right in the order written instead (`switchAt` in
   `diagram/graph.ts`): the first and last out of the side vertices, the ones between along the slanted sides, a middle exit straight on, each with its words at its
   own port; the step the branches meet stands under the decision and each branch enters it by its own point with its own arrowhead. A parallel's bar spans its branches and
   every line meets it straight; a loop's back edge returns by one bend to the decision's side vertex; a foreach is a dashed frame (dashes mean "repeats"), see
   [diagram](diagram.md) "Four shapes beyond an if/else".
   A lesson `MermaidDiagram` gives every `{…}` decision with two or more edges out these vertex ports (`decisionBranches` in `diagram/graph.ts`), in the order the
   source writes its edges, and enters it by its entry vertex.
4. **Fitted, nothing clipped.** The first view is the whole graph, centred, with padding (`openView`); under 480px a directional graph is laid out top-down. A lesson
   `MermaidDiagram` always opens whole, contain-fitted and clear of its controls row, its canvas grown first; under zoom 0.85 the reader zooms in (`diagram/open.ts`, [diagram](diagram.md) "Variants").
5. **Dashed means something; one arrowhead.** A dashed line is a reply, an untaken or fallback branch, a back edge or an author's dotted link, never decoration. Every
   edge ends in one open arrowhead (10 by 10) at its target, nowhere else. An untaken branch is dotted in the muted tone, never faded out of sight. In a lesson
   `MermaidDiagram` flowchart the dash says what an edge carries: a call is solid in the accent, data (`-.->`) dashed in the muted neutral, with a legend chip in the
   canvas corner when both are drawn ([diagram](diagram.md) "An architecture flowchart"). Pointing at or focusing a node there dims what is not one edge from it.
6. **Every stretch is drawn once.** One edge is one drawn line: the running state restyles that line (the success tone, its dashes moving), never a second path over or
   beside it. Where two edges would share a stretch (a corridor into one target, a run out of one source), the stronger state keeps it with the one arrowhead
   (running over waiting over taken over plain over pending and skipped) and the other ends or starts where it meets that line, at a small junction dot
   (`dedupeRuns` in `shared/overlap.ts`, run by the canvas once the states are known); a middle run that would lie in another edge's corridor moves
   `PARALLEL_GAP` (12) aside. A branch's words stand on its own edge at the split, and that edge visibly reaches its target. A lesson `MermaidDiagram` has no
   junction: every edge is its own line with its own arrowhead, since its edges may each take a tone and two tones on one line would read as one flow. Two
   edges never leave or enter a node at one point: the ends on one side are spread `END_SPREAD` (16) apart in the order of their other ends, a first run that
   would lie along another edge's run slides clear (`separateEnds` in `diagram/graph.ts`), a step three or more edges enter is wide enough for them, and the
   canvas cuts no route short (`dedupeRuns` with `join: false`), so no junction dot is drawn.

Proof: by reading (GRAMMAR-NO-TESTS, [proof](../proof.md)): the graph stories and the `npm run ext:demo` routes draw, in light and
dark, no edge with a bend between ends on one rank line, at most one bend otherwise, no jog, every stretch drawn once, each edge its own line, a
branch as an if/else with its words at the split, and a decision's main branch under it. Known gap: the one-bend route is refused where it would cross a
node, and an edge into or out of a container or on a named side port keeps ELK's route, so a crowded graph can still show an edge with two bends.

## Look

A card is 280 wide (a card with a column of ports down its end side, 376), radius `--grammar-radius-lg`, a 1.5px border in its state tone. The `icon` is the round 40px tile at its left, on a plate in the soft pair of the state's tone. The label is the Grammar item label role (14 / 500), the description the caption role (12, muted). A selected node has one 2px border in its tone and a soft tint, never a second ring. Every drawn pixel is a hit area: the edges have no wider invisible path, the handles are neither seen nor hit.

## Layout and helpers

`layoutSpine(sizedNodes, links, { islands, width, measure })` is the pure spine layout (with its `bars` and each route's `end`: an arrow, a merge dot or a bar); `layoutFlow(sizedNodes, links, { direction, islands, width })` is the pure ELK layout with the routing law (the lesson diagrams), `layoutLayered` the `layered` flow layout (one ELK run, nothing re-routed after); each returns the top-left corner and the box of each node, rounded to whole pixels, and the same graph always gets the same layout. `layoutGraph` is its positions only. `resolveFlow`, `buildFlowNodes`, `buildFlowEdges`, `buildEntityNodes`, `isEdgeAnimated`, `normalizeStatus`, `statusTone`, `findConcurrentRunning` and the rest are exported for a custom canvas.

`@xyflow/react` and `elkjs` are dependencies; `react` and `react-dom` are peers.

## The demo

`npm run ext:demo` in packages/grammar serves every story (the six states, a decision, a loop, containers, islands, the legend, edge variants, a vertical graph, editing, loading, the schema map) at `http://127.0.0.1:5294/?story=<id> (one server, one port of its own; every mode is a route)`, looked at in a browser at 1440 and 390 wide. The demo is not published.
