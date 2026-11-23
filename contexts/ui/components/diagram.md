# Diagram: MermaidDiagram

Contract: [Diagram](../../grammars/contract.md#diagram). Vendor: [Alert](../../vendor/heroui.md#alert),
[small members](../../vendor/heroui.md#small-members) (Skeleton). Canvas: the core's graph ext ([graph](graph.md)).

## Job
Draw an authored structure the reader follows (a flow, a sequence, the states of a thing) on the same canvas as every graph of the
Grammar, in the grammar's tokens, without the page jumping while it draws.

## Choose

Choice `diagram.choose.renderer`: which component draws the structure. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| authored | the structure is Mermaid text the content carries (an article's `mermaid` code fence, a lesson body) | `MermaidDiagram` of `@starci/grammar/core/ext/graph` with the fence's text as `source` and a `label` naming what it shows; inside `Markdown`, its `renderDiagram` slot hands each fence to it | `DNA-COMMON-DIAGRAM-NAMED` |
| data | the reader must SEE a structure of steps, relations or clusters held as data: a run's flow, a data ERD, a knowledge map | the core's graph ext, `@starci/grammar/core/ext/graph` (`FlowGraph`, `SchemaMap`, `ErdMap`, `KnowledgeMap`; see [graph](graph.md)); no `Fragment`, it is Grammar | judgement |
| list | the structure is a sequence of steps with no branches | not a diagram: `Stepper` or `Timeline` | judgement |

## The canvas
Authors keep writing Mermaid; Mermaid is the parser and the graph ext is the renderer. Every diagram stands in the graph's frame: its dot
grid, pan by drag, touch or the arrow keys, zoom by pinch, the + and - keys or the zoom buttons, fit and reset (0) beside them in a row along
the bottom, the Grammar's nodes, edges, arrowheads and fonts (`label.field`, 13 / 18).

- **Flowchart and state diagram**: Mermaid's own database (vertices, links and subgraphs; states and transitions) becomes a graph laid out by
  ELK, layered, with as few crossings as the layout finds, routed by the routing law. A node is a rounded box in the shape its source
  names: `[(db)]` a cylinder, `{x}` a decision diamond, `((x))` a circle, `([x])` a stadium; a subgraph or a composite state is a container its
  nodes stand in; `[*]` is a start dot or an end ring; an edge's words are a pill on its line, a dotted link (`-.->`) dashed. RL draws across,
  BT down. A decision with two or more edges out is entered by its entry vertex and its branches leave by its other vertices, in the order the source
  writes them (an if/else: the first straight on, the second to the side), each with its words at its own vertex; branches that lead on to one node
  rejoin its line at a junction, and one arrowhead enters it. Three or more edges out make a switch (below).
- **A branch is an if/else.** A flowchart splits only at a decision: a `{…?}` node whose words ask the condition, one labelled edge per answer
  (yes / no), the branches rejoining with plain arrows where the flow goes on. An ordinary box with two or more labelled edges out is not a branch:
  when the edges are all taken their words go in the nodes, and when they are an if/else the author writes the decision. The renderer never invents
  the question; a development build (`NODE_ENV` not `production`) logs one `console.warn` per such box (`branchesWithoutDecision` in
  `diagram/model.ts` is the pure check).
- **Four shapes beyond an if/else**, all plain Mermaid (no new diagram type; each draws by the routing law, [graph](graph.md) "The routing law"):
  - **Switch**: a `{…}` decision with three or more labelled edges out, one per case, the default ("Khác", "Else") written last. The exits stand left to right in
    the order written: the first out of the side vertex, the last out of the other, the ones between along the slanted sides (the decision is as tall as the
    exits need), a middle exit of an odd count out of the bottom vertex; each case's words are a pill on its own edge at its port. The branches rejoin on one
    line just above the step they meet, which stands under the decision, with one arrowhead.
  - **Parallel**: `F@{ shape: fork, label: "Song song" }` splits and `J@{ shape: join }` merges (Mermaid's own `fork` and `join` shapes; the label is
    optional and short, since it stands above the bar's left end). A bar is a thin solid bar as wide as the branches it spans plus 24 past the outermost; every
    line meets it straight, at its branch's centre, so the branches run side by side. A join's lines each end at the bar with an arrowhead; a state diagram's
    `<<fork>>` and `<<join>>` are the same bar.
  - **Loop**: no new syntax. A decision whose body leads back to it (`L{Còn nữa?}`, `L -->|Có| Body`, `Body --> L`, `L -->|Không| Out`) is a loop: write Có
    (into the body) first, so it runs straight on, and Không second, out of the side vertex. The link that closes the cycle on the decision is the back edge
    (`loopBackEdges` in `diagram/model.ts`), dashed because it returns: out of the side of the last step, along, and up into the decision's side vertex, one
    bend, on the outside of the body. The decision is widened (taller across when the flow runs across) so the body stands clear of that line. Any other
    cycle (not closing on a decision) is left to the layout.
  - **Foreach**: a subgraph with `class E foreach`, titled with the author's words ("Với mỗi đơn ×3"), and plain links to and from the subgraph id
    (`A --> E`, `E --> Z`): a dashed frame round the body steps, entered at its top and left at its bottom. The dashes mean "repeats", the one meaning a
    dashed frame has; a subgraph without `foreach` is the quiet solid field.
- **Sequence**: participants are header boxes in one row (an actor pill-round), each with a dashed lifeline; each message is an edge between two
  anchor points of its row on the two lifelines, in the order written (a reply dashed, a lost message a cross, a self-message a loop to the
  right), its words over the line (numbered under `autonumber`); a note is a soft accent pill over the lifelines it spans; `alt`, `loop`, `opt`,
  `par`, `critical` and `break` are quiet tinted fields round their rows, the kind and words in the top corner, a dashed divider per `else`.
- **Any other kind** (gantt, pie, journey, ...): Mermaid's own SVG in the Grammar's diagram theme, placed as one node on the same canvas.

## Variants
`height` reserves the canvas box (`sm` 16rem, `md` 24rem, `lg` 32rem): pick the step the finished drawing fills, so the loading box is the
ready box. A taller drawing grows the canvas to fit it, up to 45rem (30rem on a phone, so the page stays in reach past a canvas a finger pans). The first view
is the whole drawing, centred, at 100% or less, but never under the **readable floor**: `READABLE_ZOOM` 0.85, where caption-role words (13px) stay at 11px or more.
A sequence or a flowchart that does not fit whole at 0.85 opens at 0.85 from its start (a sequence: its first participant and first message at the top left; a
flowchart or state diagram: its entry node, the first node nothing leads into, kept in view) and the reader pans by touch or drag and zooms by pinch, the
buttons or + and -; fit (the button) still shows the whole drawing down to 0.2, reset (0) returns to the first view. Any other kind (Mermaid's own SVG)
keeps the least zoom of 0.2. There is no list fallback on a phone: the same canvas, the controls row kept, the text version visually hidden for assistive
technology. The drawing follows the graph ext's routing law ([graph](graph.md) "The routing law": no handle dots, straight or one bend, a decision's main branch straight on with every branch
labelled at the split, fitted, dashed only when the source means it and one open arrowhead). Under 480px a flowchart or a state diagram is laid out
top-down so it fits the width. Paint is the grammar's, read from the root's tokens; an app passes no
colours.

Tones and caption: a flowchart node or a state takes a tone, `danger` for the faulty step, `success` for the fix, `accent` for a part the change
touches, either by `tones={{ B: "danger" }}` or by Mermaid's own `class B danger` in the source; the node is painted in the tone's soft pair and
edge, and a colour the source writes (a `classDef`, a `style` line) never paints. A sequence's message takes one by its place among the messages,
counted from 1: `messageTones={{ 5: "danger" }}` paints the fifth message's line, head and words. `caption` is one line under the canvas in the
caption role, saying what to look at. `labels` gives the canvas's words (the zoom, fit and reset buttons; the text version's start and end).

## Size
No control size. The canvas is the frame's full width; a phone keeps the same canvas inline, panned and pinched by touch.

## States
Loading keeps the reserved box with a skeleton (`isLoading` while the source is unresolved; Mermaid itself loads lazily on the first diagram).
A source Mermaid refuses is an error in the same region: the error title, then the source as code, so the reader keeps the text (STATE-8).

## Accessibility
The canvas is a region named by `label`, a Tab stop that pans with the arrow keys and zooms with + and - (0 resets); the drawing inside it is
one image with the same name. A visually hidden text version follows it: a graph's nodes (a member with its container) then its links (who to
whom, with their words); a sequence's messages in order (who to whom: what) with its notes and blocks where they stand.

## Owner split
- **Grammar owns:** the frame and canvas, the reserved box, the parser-to-graph mapping, the layouts, the node and edge paint, the theme over
  Mermaid's own SVG, the tones, the text version, the error carrier, and loading Mermaid only when a diagram mounts.
- **Knowledge decides:** which renderer; the height step.
- **App author decides:** the source, the label, the caption, the tones, the words (`labels`, the error title).

## Rules
STATE-8, OVERFLOW-4. Stack: [diagrams](../../stack/fe.yaml) (Mermaid is the Grammar's dependency, xyflow and ELK the graph ext's optional
peers; an app imports `MermaidDiagram` from `@starci/grammar/core/ext/graph` and its stylesheet once, never `mermaid`). Story
`Content/Lesson diagrams (0.55.1)`: a sequence and one with blocks, a flowchart across and down, a state diagram, other kinds, loading and
error, each light and dark, with tones.
