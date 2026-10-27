---
schema: starci/op@1
summary: draw screens, generate assets, grow the Grammar
floor: hard
hostTools: [git, node, browser]
context:
  budget: 40000
  base:
    - {file: "harness:contexts/project/README.md", shared: true}
    - harness:contexts/project/anatomy-{edition}-fe.md
    - {file: "harness:contexts/project/lint.md", shared: true}
    - harness:contexts/project/{edition}.md
    - {file: "harness:contexts/code/README.md", shared: true}
    - {file: "harness:contexts/code/shared/README.md", shared: true}
    - {file: "harness:contexts/code/shared/typing.md", shared: true}
    - {file: "harness:contexts/code/shared/format.md", shared: true}
    - {file: "harness:contexts/code/shared/loosening.md", shared: true}
    - {file: "harness:contexts/code/shared/comment.md", shared: true}
    - {file: "harness:contexts/code/shared/naming.md", shared: true}
    - {file: "harness:contexts/code/shared/imports.md", shared: true}
    - {file: "harness:contexts/code/shared/test.md", shared: true}
    - {file: "harness:contexts/code/shared/scripts.md", shared: true}
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
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the ui and pattern rules the screen follows (never the shared files)"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the ui records the screen implements"}
checks:
  base: [check-run-green, paths-only, rules-cited]
  behavioural: false
---
Compose the grammar's components through its API; the app writes layout CSS only and makes no visual choice the grammar
or a ui rule decides. A component or token the grammar lacks is a gap of the grammar: file `blocked` naming it, never
draw it in the app.
