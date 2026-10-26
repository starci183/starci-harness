---
schema: starci/op@1
summary: draw screens, generate assets, grow the Grammar
floor: hard
hostTools: [git, node, browser]
context:
  base:
    - harness:contexts/project/README.md
    - harness:contexts/project/anatomy.md
    - harness:contexts/project/lint.md
    - harness:contexts/project/{edition}.md
    - harness:contexts/code/README.md
    - harness:contexts/code/shared/README.md
    - harness:contexts/code/shared/typing.md
    - harness:contexts/code/shared/format.md
    - harness:contexts/code/shared/loosening.md
    - harness:contexts/code/shared/comment.md
    - harness:contexts/code/shared/naming.md
    - harness:contexts/code/shared/imports.md
    - harness:contexts/code/shared/test.md
    - harness:contexts/code/shared/scripts.md
    - harness:contexts/ui/README.md
    - harness:contexts/ui/composition.md
    - harness:contexts/ui/scale.md
    - harness:contexts/grammars/contract.md
    - harness:contexts/grammars/{grammar}.md
    - harness:contexts/code/fe/README.md
    - harness:contexts/code/fe/ui.md
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
