# Diagram: MermaidDiagram and FlowGraph

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
| list | the structure is a sequence of steps with no branches | not a diagram: `Stepper` or `Timeline` | judgement |

Choice `diagram.choose.shape`: the outline of a `FlowGraph` node. Each meaning has one shape.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| decision | the node asks a question its outgoing edges answer | `shape: "diamond"`, each outgoing edge with a `label` (the answer) | `DNA-COMMON-FLOW-EDGE-LABEL-SPOKEN` |
| terminal | the node starts or ends the flow | `shape: "circle"` | judgement |
| step | the node is an action or a state of the flow | `shape: "rect"`, or `round` for a step the reader acts on | judgement |
| entity | the node is a thing in a map (not a flow) | the default `stadium` | judgement |
| sized thing | the map shows how much each thing holds (files, items) and the reader hovers for the name | `form: "bubble"`, `layout="orbit"` and `diameter` from `flowGraphDiameter(value, max)` so area tracks value | judgement |

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
drops out when it no longer fits: the caption under zoom 0.42, the mark under 0.5. Ring four of the orbit layout cannot
meet the floor at full view, so a map in `orbit` takes `fit="contain"`.

## States
Loading keeps the reserved box with a skeleton (`isSkeleton` while the source is unresolved; Mermaid itself loads
lazily on the first diagram). A source Mermaid refuses is an error in the same region: the error title, then the
source as code, so the reader keeps the text (STATE-8). An empty `FlowGraph` shows its `emptyLabel`.

## Owner split
- **Grammar owns:** the frame, the reserved box, the theme handed to Mermaid, the node shapes, the bubble, its fills, ring and tip, the orbit rings and fans, the strong edges of the selected path, the edge label paint,
  the error carrier, the screen-reader text of labelled edges, and loading Mermaid only when a diagram mounts.
- **Knowledge decides:** which renderer; which shape a node takes; the height step.
- **App author decides:** the source or the nodes and edges, the label, the error title copy.

## Rules
STATE-8, OVERFLOW-4. Stack: [diagrams](../../stack/fe.yaml) (Mermaid is the Grammar's dependency; an app imports
`MermaidDiagram`, never `mermaid`).
