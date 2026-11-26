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
  each enter it by their own point. Three or more edges out make a switch (below).
- **Every edge is its own line.** Two edges never leave or enter a node at one point and never share a stretch: the ends on one side of a node stand 16 apart,
  ordered by where their other ends lie, and the canvas draws no junction dot, so each edge keeps its own arrowhead and its own tone (the routing law, rule 6,
  [graph](graph.md)). Lines may cross; they never merge.
- **A branch is an if/else.** A flowchart splits only at a decision: a `{…?}` node whose words ask the condition, one labelled edge per answer
  (yes / no), the branches rejoining with plain arrows where the flow goes on. An ordinary box with two or more labelled edges out is not a branch:
  when the edges are all taken their words go in the nodes, and when they are an if/else the author writes the decision. The renderer never invents
  the question; a development build (`NODE_ENV` not `production`) logs one `console.warn` per such box (`branchesWithoutDecision` in
  `diagram/model.ts` is the pure check).
- **Four shapes beyond an if/else**, all plain Mermaid (no new diagram type; each draws by the routing law, [graph](graph.md) "The routing law"):
  - **Switch**: a `{…}` decision with three or more labelled edges out, one per case, the default ("Khác", "Else") written last. The exits stand left to right in
    the order written: the first out of the side vertex, the last out of the other, the ones between along the slanted sides (the decision is as tall as the
    exits need), a middle exit of an odd count out of the bottom vertex; each case's words are a pill on its own edge at its port. The branches rejoin at
    the step they meet, which stands under the decision, each entering it by its own point in the order of the cases.
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
ready box. A taller drawing grows the canvas to hold it at its width fit, up to 45rem (35rem on a phone, so the page stays in reach past a canvas a
finger pans). **The fit rule** (`diagram/open.ts`, Next UI audit round 3, 2026-11-25): the first view is always the WHOLE drawing, contain-fitted
(zoom = min(1, room width / width, room height / height)) and centred in the room, the frame less 16px on three sides and the 64px controls row along the
bottom, so no node is cut on any side and the zoom buttons never stand over the drawing. Height is bought first (the canvas grows, up to its tallest);
width by the layout (a flowchart or state diagram is top-down under 480px, and elsewhere when across would open under the readable zoom and top-down
opens it larger). A drawing that still opens under the **readable zoom**, `READABLE_ZOOM` 0.85 (caption-role words of 13px at 11px or more), opens whole
and small: the reader zooms in by pinch, double tap, the buttons or + and -, pans by touch, drag or the arrow keys; fit (the button) and reset (0)
return to the whole drawing. A first view that hides a part the reader cannot know is there is the worse failure; a small one only asks for a zoom. The
canvas's least zoom is 0.2, or the first view's own zoom when a very large drawing needs less. There is no list fallback on a phone: the same canvas,
the controls row kept, the text version visually hidden for assistive
technology. The drawing follows the graph ext's routing law ([graph](graph.md) "The routing law": no handle dots, straight or one bend, a decision's main branch straight on with every branch
labelled at the split, fitted, dashed only when the source means it and one open arrowhead). Under 480px a flowchart or a state diagram is laid out
top-down so it fits the width. Paint is the grammar's, read from the root's tokens; an app passes no
colours.

Tones, legend, icons and caption: a flowchart node or a state takes a tone, `danger` for the faulty step, `success` for the fix, `accent` for a part the
change touches, `info` for a second, neutral flow beside the accent one, either by `tones={{ B: "danger" }}` or by Mermaid's own `class B danger` in the
source; the node is painted in the tone's soft pair and edge, and a colour the source writes (a `classDef`, a `style` line) never paints. A flowchart's
edge takes a tone to tell two flows apart (a read path and a write path): by Mermaid's own edge id and class (`A r1@--> R`, then `class r1,r2 info`), or
by its place among the links counted from 1, `edgeTones={{ 2: "info" }}` (the map wins); its line, arrowhead and words take the tone. `legend` names
what each edge tone means, one short line in the tone and its words per item, as a row under the canvas above the caption. A node may name an icon with
Mermaid's own `R@{ icon: "redis" }` (the shape `R[(…)]` gave it stays); Grammar draws the name itself:
the built-in tech logos of `techIcons` (exported from `@starci/grammar/core/ext/graph`) are the default, so every app shows the same ones and passes nothing. Built-in names, exactly as
written in the source: `postgresql`, `mongodb`, `mysql`, `redis`, `express`, `nestjs`, `nodedotjs`, `docker`, `kubernetes`, `rabbitmq`, `apachekafka`, `nginx`, `graphql`, `typescript`, `javascript`, `go`, `python`, `react`, `nextdotjs`, `elasticsearch`, `minio` (simple-icons, CC0;
`amazons3` is not shipped there), the generic outline marks `database` (any store without a logo) and `service` (any program without one), and the aliases
`postgres`, `pg`, `mongo`, `nodejs`, `node`, `kafka`, `k8s`, `nextjs`, `next`, `golang`, `nest`, `elastic`, `ts`, `js`. A logo stands in its own
**logo chip** before the words (26px, the neutral tint, the mark 18px inside, `LogoChip`) and is hidden from a screen reader (the node's words name it). It is
**brand-coloured**: it fills with its brand's official hex (simple-icons' `hex`, `techIconColors`) when that hex keeps a WCAG contrast of 3:1 (`LOGO_CONTRAST`)
against the chip in the theme in force, read from the page (`logoInk.ts`); under it, it falls back to the node's ink (Express and Next.js black on a dark chip, React
and JavaScript pale on a light one). The built-in set is simple-icons with its hex, not Iconify's `logos:` originals: one CC0 path per logo, no new dependency,
and a contrast rule that keeps every mark legible in light and dark, where a multi-colour original often carries its own dark ink. `database` and `service`
stay in the ink. `icons={{ redis: <img … /> }}` adds a name or overrides a built-in one, and keeps its own colours (no brand colour is laid over it);
a name neither has draws nothing and takes no room. A subgraph takes an icon the same way (`D@{ icon: "docker" }`), drawn before its name.

**An architecture flowchart** (services, stores and the calls between them) says more than its boxes, all in plain Mermaid:
- **Port.** A service's port at the end of its label (`O[orders :4001]`, or on a line of its own) is taken off the name and drawn as a muted pill after it
  (`splitPort`); a decision keeps its words whole.
- **"The learner edits here".** `class O edit` (`EDIT_CLASS`, Mermaid's own `class` statement, like `class B danger`) puts a pencil chip in the accent tint
  after the node's words, with no file name; the text version and the node's button add `labels.edit` ("you edit this"). The mark is a class, not an
  `X@{ icon }`, because the icon slot holds the node's logo and a node can carry both.
- **Stores.** A `[( )]` node (a database, a cache) is a rounder cylinder than a service's box: deep elliptic caps, a tinted side and a deeper lid.
- **Calls and data.** A flowchart's plain or thick link is a **call**, solid in the accent with its arrowhead; a dotted link (`-.->`) carries **data**, dashed in
  the muted neutral (`edgeKind`); a loop's back edge returns along the calls. A tone (`edgeTones`, `class e1 info`) wins over both. When a flowchart has
  both kinds, a legend chip (`labels.calls`, `labels.data`) stands in the canvas's bottom right corner, in the controls row the fit rule keeps clear, so it
  never covers a node (`needsKindLegend`). A state diagram's transitions keep the quiet line.
- **Hover focus.** Every step and store of a flowchart or a state diagram is a Tab stop (a button named by its words, port and edit mark). Pointing at it or
  focusing it lights it, its neighbours and the edges between them, and dims everything else (`neighbourhood`); a container keeps its frame. Pressing it
  (click, Enter or Space) opens its **description line**, Mermaid's own tooltip (`click O call note() "Takes the order"`), at the top of the canvas as a
  status; Escape closes it. A step with no tooltip only lights. Drag, the dot grid, the group container, the controls and the fit rule are unchanged.  A sequence's message takes a tone by its place
among the messages, counted from 1: `messageTones={{ 5: "danger" }}` paints the fifth message's line, head and words. `caption` is one line under the
canvas in the caption role, saying what to look at. `labels` gives the canvas's words (the zoom, fit and reset buttons; the text version's start and end).

## Size
No control size. The canvas is the frame's full width; a phone keeps the same canvas inline, panned and pinched by touch.

## States
Loading keeps the reserved box with a skeleton (`isLoading` while the source is unresolved; Mermaid itself loads lazily on the first diagram).
A source Mermaid refuses is an error in the same region: the error title, then the source as code, so the reader keeps the text (STATE-8).

## Accessibility
The canvas is a region named by `label`, a Tab stop that pans with the arrow keys and zooms with + and - (0 resets). A graph's drawing is a group of
that name whose steps and stores are buttons (focus lights the neighbourhood as hover does, Enter opens a description line, announced as a status); a
sequence's or another kind's drawing inside it is
one image with the same name. A visually hidden text version follows it: a graph's nodes (a member with its container) then its links (who to
whom, with their words); a sequence's messages in order (who to whom: what) with its notes and blocks where they stand.

## Owner split
- **Grammar owns:** the frame and canvas, the reserved box, the parser-to-graph mapping, the layouts, the node and edge paint, the theme over
  Mermaid's own SVG, the tones, the text version, the error carrier, and loading Mermaid only when a diagram mounts.
- **Knowledge decides:** which renderer; the height step.
- **App author decides:** the source, the label, the caption, the tones, the legend, the icons it draws, the words (`labels`, the error title).

## Rules
STATE-8, OVERFLOW-4. Stack: [diagrams](../../stack/fe.yaml) (Mermaid is the Grammar's dependency, xyflow and ELK the graph ext's optional
peers; an app imports `MermaidDiagram` from `@starci/grammar/core/ext/graph` and its stylesheet once, never `mermaid`). Story
`Content/Lesson diagrams (0.55.1)`: a sequence and one with blocks, a flowchart across and down, a state diagram, other kinds, loading and
error, each light and dark, with tones; `TonedPaths` two toned flows through the same stores with a legend and icons; `TechLogos` the shop-giay architecture with the built-in logos in their brand colours and the ink fallback (express, postgresql, redis, docker on its group),
the ports, the edit mark on payments, the store cylinders, calls and data with the legend chip; `HoverFocus` the same drawing pointed at and focused, with a
description line opened by Enter.
