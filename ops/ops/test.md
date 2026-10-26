---
schema: starci/op@1
summary: write the back-end tests of one slice, inside test paths only (the front end has no tests, SHARED-TEST-1)
floor: medium
hostTools: [git, node]
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
    - harness:contexts/code/be/README.md
    - harness:contexts/code/be/test.md
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
