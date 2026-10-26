---
schema: starci/op@1
summary: draw screens, generate assets, grow the Grammar
floor: hard
hostTools: [git, node, browser]
context:
  base:
    - harness:knowledge/ui/README.md
    - harness:knowledge/ui/composition.md
    - harness:knowledge/ui/scale.md
    - harness:knowledge/grammars/contract.md
    - harness:knowledge/grammars/{grammar}.md
    - harness:knowledge/patterns/fe/README.md
    - harness:knowledge/patterns/fe/ui.md
input:
  base:
    grammar: the grammar the app composes, `sides.fe.grammar` of its hfs.json (core or offset-pop)
output:
  base:
    summary: {type: string, summary: "what you drew or changed"}
    files: {type: "string[]", summary: "the repository paths you changed"}
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the ui and pattern rules the screen follows"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the ui records the screen implements"}
  behavioural: false
checks:
  base: [check-run-green, paths-only, rules-cited]
  behavioural: false
---
Compose the grammar's components through its API; the app writes layout CSS only and makes no visual choice the grammar
or a ui rule decides. A component or token the grammar lacks is a gap of the grammar: file `blocked` naming it, never
draw it in the app.
