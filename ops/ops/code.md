---
schema: starci/op@1
summary: scaffold, implement, fix, refactor or remove a feature
floor: medium
hostTools: [git, node]
context:
  base:
    - file: "harness:knowledge/project/README.md"
      when: {side: [be, fe]}
    - file: "harness:knowledge/project/anatomy.md"
      when: {side: [be, fe]}
    - file: "harness:knowledge/project/lint.md"
      when: {side: [be, fe]}
    - file: "harness:knowledge/project/{edition}.md"
      when: {side: [be, fe]}
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
    - file: "harness:knowledge/patterns/{side}/README.md"
      when: {side: [be, fe]}
    - file: "harness:CONTRIBUTING.md"
      when: {side: harness}
    - file: "harness:cli/README.md"
      when: {side: harness}
input:
  base:
    side: the side the task writes, be (the NestJS back end), fe (the Next.js front end) or harness (this harness repository itself)
    edition: the app's edition, `edition` of its hfs.json (lite or full; full when absent); harness for a harness task
output:
  base:
    summary: {type: string, summary: "what you changed and why"}
    files: {type: "string[]", summary: "the repository paths you changed"}
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the rules the code follows"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records the code implements"}
  behavioural: false
checks:
  base: [check-run-green, paths-only, rules-cited]
  behavioural: true
---
Write the code of the slice and the tests that prove what it changed, in the slots the anatomy gives and the patterns of
the topics you read. Code traces to its Work records and never redefines them: a record that is wrong or missing is a
`mismatch`, not a guess.
