---
schema: starci/op@1
summary: write the back-end tests of one slice, inside test paths only (the front end has no tests, SHARED-TEST-1)
floor: medium
hostTools: [git, node]
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
    - harness:knowledge/patterns/be/README.md
    - harness:knowledge/patterns/be/test.md
    - harness:packages/jest-preset/README.md
input:
  base:
    edition: the app's edition, `edition` of its hfs.json (lite or full; full when absent)
output:
  base:
    summary: {type: string, summary: "what the tests prove"}
    files: {type: "string[]", summary: "the test files you wrote"}
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the testing rules the tests follow"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records the tests prove"}
  behavioural: false
checks:
  base: [paths-only, rules-cited]
  behavioural: true
---
Write only tests. A test that fails because the code is wrong stays red and the result says so; never change product
code, and never weaken an assertion to make it pass.
