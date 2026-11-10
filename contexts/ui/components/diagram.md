# Diagram: MermaidDiagram, FlowGraph and BubbleMap

Contract: [Diagram](../../grammars/contract.md#diagram). Vendor: [Alert](../../vendor/heroui.md#alert),
[small members](../../vendor/heroui.md#small-members) (Skeleton).

## Job
Draw a structure the reader follows (a flow, a sequence, a map of related things) as one named image, in the
grammar's tokens, without the page jumping while it draws.

## Choose

Choice `diagram.choose.renderer`: which component draws the structure. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| authored | the structure is Mermaid text the content carries (an article's `mermaid` code fence, a lesson body) | `MermaidDiagram` with the fence's text as `source` and a `label` naming what it shows | `DNA-COMMON-DIAGRAM-NAMED` |
| data | the app holds the nodes and edges as data, or the reader selects, follows links or zooms | `FlowGraph` with `nodes`, `edges`, and `direction` for a flow | judgement |
| workflow | the app draws the work of an agent or a business flow: an event that starts it, steps, conditions that fork it, asks and waits for the owner, the end | `FlowGraph layout="steps"` (0.35.0, the owner-approved card map): top-down by default (`direction="LR"` runs across) on the well with no grid; a white card per step (196 wide, 14 corners, the card border) with a 32 icon tile in its `kind`'s soft pair (`event`, `action`, `condition`, `ask`, `wait` dashed, `end` a "Xong" pill with a check), the title 14 medium, one muted 12 line, an optional corner `tag` (an 18px chip, 12px text); a condition carries its named `outputs` along its bottom and each edge leaves its port (`sourcePort`), so branch words live on the ports, never on the lines; smooth curved 1.5px edges with a closed rounded chevron arrowhead (0.37.5, about 8px, filled in the edge colour, crisp at any zoom) and solid 6px round port and anchor dots in the edge colour, meeting the middle of a card's top or bottom edge; a `variant: "back"` edge is dashed, routed round the cards, with a pill `label`; `legend` adds a row of kinds; the run overlay is node `status` and edge `isTaken`, composed by the state-priority law below. 0.37.4: node `chips` (up to 3 pills under the title, then "+N"; accent = a dynamic parameter, neutral = a fixed one); `outputs` on any kind, a port `tone: "danger"` for the error output ("Lỗi"); `container` (`label`, `chips`, `childIds`) for a loop card that holds its children; a disconnected graph stacks its islands, one node may fan out to several targets and several entry nodes may feed one step. 0.37.5: `background="dots"` (xyflow's dot Background, 18px, muted); `isEditable` + `positions` + `onPositionsChange` (drag the blocks, edges re-route live, an outline "Sắp xếp lại" reset in the zoom group); node `agent` (`{ name, avatar? }`: a 16px avatar and the name under the title, for a block of another agent) | judgement |
| workflow (lanes, kept) | an existing caller of the left-to-right branch map | `FlowGraph layout="lanes"`; new work takes `steps`: a column per stage and one row per branch, the node `kind` (`trigger`, `condition`, `execute`, `output`) sets the tone, a branch label on its own edge as an opaque chip above every line (its column widens to hold the words), column headers only over a column that holds a node | judgement; `DNA-COMMON-FLOW-LANE-LABEL-ABOVE-LINES`, `DNA-COMMON-FLOW-LANE-LABEL-OPAQUE` |
| list | the structure is a sequence of steps with no branches | not a diagram: `Stepper` or `Timeline` | judgement |

Choice `diagram.choose.shape`: the outline of a `FlowGraph` node. Each meaning has one shape.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| decision | the node asks a question its outgoing edges answer | `shape: "diamond"`, each outgoing edge with a `label` (the answer) | `DNA-COMMON-FLOW-EDGE-LABEL-SPOKEN` |
| terminal | the node starts or ends the flow | `shape: "circle"` | judgement |
| step | the node is an action or a state of the flow | `shape: "rect"`, or `round` for a step the reader acts on | judgement |
| entity | the node is a thing in a map (not a flow) | the default `stadium` | judgement |
| sized thing | the map shows how much each thing holds (files, items) and the reader hovers for the name | `BubbleMap`, `form: "bubble"` and `diameter` from `bubbleDiameter(value, max)` so area tracks value | judgement |

Choice `diagram.choose.status`: how a bubble shows a status. Every status takes a `fill`, so colour is never the only signal.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| one status per node | the node is in exactly one state | `tone` for the meaning and `fill` for the form: `solid` done, `half` partial, `soft` drafted, `outline` missing, `hatched` a template | judgement |
| a mix of states | the node holds several things in different states | `ring`, one arc per state, in the tone of that state | judgement |
| filtered out | the reader filters the map | `isDimmed` on the nodes out of the filter; they keep their place and focus | judgement |

## Variants
`height` reserves the canvas box (`sm` 16rem, `md` 24rem, `lg` 32rem): pick the step the finished drawing fills, so the
loading box is the ready box. Paint is the grammar's, read from the root's tokens; an app passes no colours.

## Size
No control size. Node text never renders below 12px in `FlowGraph`'s default fit; a Mermaid drawing narrows to the
frame up to its natural width. A bubble's text keeps one screen size through the viewport zoom (12px, the same floor) and
drops out when it no longer fits: the caption under zoom 0.42, the mark under 0.5. Ring four of a `BubbleMap` cannot
meet the floor at full view, so it takes `fit="contain"`.
A contained `FlowGraph` fit (every `steps` graph, any `fit="contain"`) never goes below zoom 0.8 (`CONTAIN_MIN_ZOOM`; 0.6 in 0.37.26, 0.8 since 0.37.29, owner "Nâng 0.8"): a wide graph in a narrow pane, a drawer or a desktop pane
is drawn at 0.8, its canvas grows to the graph up to the `height` cap (`lg` 512px when none), the first view shows the entry node, and the
reader pans it by drag (even a static graph). The canvas is never shorter than the zoom controls column and its insets (CONTROLS-INSIDE). Law `DNA-COMMON-FLOW-READABLE-FLOOR`. A top-down card is drawn from its top edge, so a layer's cards share one top line whatever they measure (0.37.29).

## States
Loading keeps the reserved box with a skeleton (`isLoading` while the source is unresolved; Mermaid itself loads
lazily on the first diagram). A source Mermaid refuses is an error in the same region: the error title, then the
source as code, so the reader keeps the text (STATE-8). An empty `FlowGraph` shows its `emptyLabel`.

## Owner split
- **Grammar owns:** the frame, the reserved box, the theme handed to Mermaid, the node shapes, the bubble, its fills, ring and tip (a status never rests on colour alone), the `BubbleMap` rings and fans, the strong edges of the selected path, the edge label paint, the lanes
  look (one node width, body-size words with an optional subline, orthogonal rounded edges with a muted arrowhead that fork
  from one point, no line out of a terminal node, a canvas as tall as the graph that never magnifies it),
  the steps look (0.37.27, owner drawing C: left → right by default with a branching step fanning its children down the page; the card, white with a 1px
  border on the dotted ground, the kind tiles and their tones, the ports (stacked as rows under the body across), ORTHOGONAL edges only with a 10px
  rounded corner at every turn and siblings sharing one trunk, a round start dot on every edge (a white disc ringed in the edge's colour, r 4) and a
  small solid triangle at its end, the back-edge routing and its nesting, the end pill, the run's green path, badge and edge paint, the legend, a
  canvas as tall as the graph that never magnifies it),
  the error carrier, the screen-reader text of labelled edges, and loading Mermaid only when a diagram mounts.
- **Knowledge decides:** which renderer; which shape a node takes; the height step.
- **App author decides:** the source or the nodes and edges, the label, the error title copy; for `steps`, the node `icon`, `tag`, port and
  legend words, `statusLabels`, and `kindTones` when the app declared the approved purple, teal and coral tones (Core's HeroUI palette maps
  them to accent, success and danger by default).

## Rules
STATE-8, OVERFLOW-4. Stack: [diagrams](../../stack/fe.yaml) (Mermaid is the Grammar's dependency; an app imports
`MermaidDiagram`, never `mermaid`).

## FlowGraph state priority

A `steps` card shows several states at once, and each state has one channel so they never stack: the run status is the small outline status icon and its
word on the card's top-start edge (success, running, danger, waiting, skipped); the PATH a run took is green (0.37.27, owner drawing C): a card the run reached (done, running, waiting) has a 2px success border, a failed one a danger
border, a card it did not reach is faded; a selected node has exactly one 2px primary outline (an outline, never the border); the `wait` kind is dashed only in the
design view, never while a run status is shown. An edge that was taken is a solid success line with a success dot and arrowhead; an edge not taken is a dashed light-neutral line; a back edge stays dashed with its pill. Enforcer: held by review and the
`FlowGraph (steps, run overlay)` and `Flow graph style C` stories' play functions.

Islands (0.37.8): in `layout="steps"` the disconnected parts of a graph are islands; `islands="wrap"` (default) fills rows left to right by the canvas width with a 48px gap on both axes, `islands="stack"` is one column. Agent graphs keep the default.
