---
schema: starci/op@1
summary: draw screens, generate assets, grow the Grammar
floor: hard
hostTools: [git, node, browser]
context:
  base:
    - harness:knowledge/project/README.md
    - harness:knowledge/project/anatomy.md
    - harness:knowledge/project/lint.md
    - harness:knowledge/project/{edition}.md
    - harness:knowledge/patterns/README.md
    - harness:knowledge/patterns/shared/README.md
    - harness:knowledge/patterns/shared/typing.md
    - harness:knowledge/patterns/shared/format.md
    - harness:knowledge/patterns/shared/loosening.md
    - harness:knowledge/patterns/shared/comment.md
    - harness:knowledge/patterns/shared/naming.md
    - harness:knowledge/patterns/shared/imports.md
    - harness:knowledge/patterns/shared/test.md
    - harness:knowledge/patterns/shared/scripts.md
    - harness:knowledge/ui/README.md
    - harness:knowledge/ui/composition.md
    - harness:knowledge/ui/scale.md
    - harness:knowledge/grammars/contract.md
    - harness:knowledge/grammars/{grammar}.md
    - harness:knowledge/patterns/fe/README.md
    - harness:knowledge/patterns/fe/ui.md
input:
  base:
    edition: the app's edition, `edition` of its hfs.json (lite or full; full when absent)
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
