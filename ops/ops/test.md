---
schema: starci/op@1
summary: write the tests of one slice, inside test paths only
floor: medium
hostTools: [git, node]
context:
  base:
    - harness:knowledge/README.md
    - harness:knowledge/project/lint.md
input:
  base: {}
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
