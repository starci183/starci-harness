---
schema: starci/op@1
summary: "superseded by design (one board per app, PROJECT-GALLERY-9), kept for the trial: draw the direction of the screen the contract describes in the grammar and the brand (HTML and tokens)"
floor: hard
hostTools: [git, node]
perRecord: true
context:
  budget: 40000
  base:
    - harness:contexts/project/work-sections.md
    - harness:contexts/ui/README.md
    - harness:contexts/ui/composition-sections.md
    - harness:contexts/ui/scale.md
    - harness:contexts/grammars/contract-sections.md
    - harness:contexts/grammars/{grammar}.md
input:
  base:
    grammar: the grammar the app composes, `sides.fe.grammar` of its hfs.json (core or offset-pop)
output:
  base:
    summary: {type: string, summary: "the direction you drew and the choices it settles"}
    files: {type: "string[]", summary: "the repository paths you changed"}
    direction: {type: string, summary: "the direction file you wrote, under allowPaths"}
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the ui and grammar rules the direction follows"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records the direction follows (the brand)"}
    cites: {type: "string[]", minItems: 1, summary: "the anchor ids you decided by: the Choose anchor (<family>.choose[.<term>]) of every component family the direction composes, plus the DNA and rule ids you applied"}
checks:
  base: [paths-only, rules-cited, anchors-cited]
  behavioural: false
---
Draw the screen the contract describes as one static HTML file under its allowPaths, composed only of the grammar's
components and the brand's tokens, in every state the contract names, and name each artwork slot the drawing leaves for
real art in your summary. A colour, typeface or mark the brand record does not settle, or a shape the grammar cannot
render, is `blocked` naming the gap, never invented in the drawing. The owner approves the direction.

Before you place a component, search for and read its Choose section (`starci contexts search "<need>" --scope ui`) and
pick the role, variant, intent and spacing step it gives; list under `cites` the Choose anchor of every component family
the direction composes (`tabs.choose`, or a finer `tabs.choose.<term>`), the DNA and rule ids you applied, and every id the
contract hands you. An id that resolves to nothing is red (`anchors-cited`); the code that builds the screen and its
audit are graded against these cites.

A direction for an app that keeps a canvas is the canvas page of the screen (`.starcistacks/canvas`, `/claude-design`); the owner approves it before any code
([PROJECT-GALLERY-7](../../contexts/project/gallery.md#project-gallery-7-a-ui-change-goes-board-first-then-code-then-the-gallery-then-one-review)).
An app with a design board (`gallery/board/board.yaml`) is drawn by the `design` op instead, the whole board in one task.
