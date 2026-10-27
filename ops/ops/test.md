---
schema: starci/op@1
summary: write the back-end tests of one slice, inside test paths only (the front end has no tests, SHARED-TEST-1)
floor: medium
hostTools: [git, node]
perRecord: true
context:
  budget: 30000
  base:
    - {file: "harness:contexts/project/README.md", shared: true}
    - harness:contexts/project/anatomy-{edition}-be.md
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
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the testing rules the tests follow, from the back-end test topics (never the shared files)"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records the tests prove"}
checks:
  base: [paths-only, rules-cited]
  behavioural: true
---
Write only tests. A test that fails because the code is wrong stays red and the result says so; never change product
code, and never weaken an assertion to make it pass.
