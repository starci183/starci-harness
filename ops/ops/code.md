---
schema: starci/op@1
summary: scaffold, implement, fix, refactor or remove a feature
floor: medium
hostTools: [git, node]
context:
  budget: 24000
  base:
    - file: "harness:contexts/project/README.md"
      when: {side: [be, fe]}
      shared: true
    - file: "harness:contexts/project/anatomy-{edition}-{side}.md"
      when: {side: [be, fe]}
    - file: "harness:contexts/project/lint.md"
      when: {side: [be, fe]}
      shared: true
    - file: "harness:contexts/project/{edition}.md"
      when: {side: [be, fe]}
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
    - file: "harness:contexts/code/{side}/README.md"
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
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the rules the code follows, from the side's files and the topics the contract adds (never the shared files)"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records the code implements"}
checks:
  base: [check-run-green, paths-only, rules-cited]
  behavioural: true
---
Write the code of the slice and the tests that prove what it changed, in the slots the anatomy slice of your side and edition
gives and the patterns of the topics you read. Code traces to its Work records and never redefines them: a record that is
wrong or missing is a `mismatch`, not a guess.
