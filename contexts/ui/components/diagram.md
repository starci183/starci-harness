# Diagram: MermaidDiagram

Contract: [Diagram](../../grammars/contract.md#diagram). Vendor: [Alert](../../vendor/heroui.md#alert),
[small members](../../vendor/heroui.md#small-members) (Skeleton).

## Job
Draw an authored structure the reader follows (a flow, a sequence) as one named image, in the
grammar's tokens, without the page jumping while it draws.

## Choose

Choice `diagram.choose.renderer`: which component draws the structure. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| authored | the structure is Mermaid text the content carries (an article's `mermaid` code fence, a lesson body) | `MermaidDiagram` with the fence's text as `source` and a `label` naming what it shows | `DNA-COMMON-DIAGRAM-NAMED` |
| data | the app holds the nodes and edges as data, or the reader selects, follows links or zooms (a workflow map, a value-sized map of bubbles) | not Grammar since 0.49.0: the app owns the graph and draws it with the library of its choice inside a `Custom` region (see [custom](custom.md)); `FlowGraph` and `BubbleMap` are removed | judgement |
| list | the structure is a sequence of steps with no branches | not a diagram: `Stepper` or `Timeline` | judgement |

## Variants
`height` reserves the canvas box (`sm` 16rem, `md` 24rem, `lg` 32rem): pick the step the finished drawing fills, so the
loading box is the ready box. Paint is the grammar's, read from the root's tokens; an app passes no colours.

## Size
No control size. A Mermaid drawing narrows to the frame up to its natural width.

## States
Loading keeps the reserved box with a skeleton (`isLoading` while the source is unresolved; Mermaid itself loads
lazily on the first diagram). A source Mermaid refuses is an error in the same region: the error title, then the
source as code, so the reader keeps the text (STATE-8).

## Owner split
- **Grammar owns:** the frame, the reserved box, the theme handed to Mermaid, the error carrier, and loading Mermaid only when a diagram mounts.
- **Knowledge decides:** which renderer; the height step.
- **App author decides:** the source, the label, the error title copy.

## Rules
STATE-8, OVERFLOW-4. Stack: [diagrams](../../stack/fe.yaml) (Mermaid is the Grammar's dependency; an app imports
`MermaidDiagram`, never `mermaid`).
