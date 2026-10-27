---
schema: starci/op@1
summary: draw one screen's direction in the grammar and the brand (HTML and tokens) and write it into its ui record
floor: hard
hostTools: [git, node]
perRecord: true
context:
  budget: 40000
  base:
    - harness:contexts/project/work.md
    - harness:contexts/ui/README.md
    - harness:contexts/ui/composition.md
    - harness:contexts/ui/scale.md
    - harness:contexts/grammars/contract.md
    - harness:contexts/grammars/{grammar}.md
input:
  base:
    grammar: the grammar the app composes, `sides.fe.grammar` of its hfs.json (core or offset-pop)
output:
  base:
    summary: {type: string, summary: "the direction you drew and the choices it settles"}
    files: {type: "string[]", summary: "the repository paths you changed"}
    direction: {type: string, summary: "the direction file you wrote, as the ui record's `direction` names it"}
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the ui and grammar rules the direction follows"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the ui records you drew"}
checks:
  base: [paths-only, rules-cited]
  behavioural: false
---
Draw the screen the ui record describes as one static HTML file beside the record, composed only of the grammar's
components and the brand's tokens, in every state the record names; write its path into the record's `direction` and
list each artwork slot the drawing leaves for real art in the record's `assets` (`{slot, summary}`, no file yet). A colour,
typeface or mark the brand record does not settle, or a shape the grammar cannot render, is `blocked` naming the gap,
never invented in the drawing. The owner approves the direction; you never set the record's `state`.
