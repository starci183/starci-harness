---
schema: starci/op@1
summary: scaffold, implement, fix, refactor or remove a feature
floor: medium
hostTools: [git, node]
perRecord: true
context:
  budget: 24000
  base:
    - file: "harness:contexts/project/anatomy-{edition}-{side}.md"
      when: {side: [be, fe]}
    - file: "harness:contexts/project/{edition}.md"
      when: {side: [be, fe]}
    - {file: "harness:contexts/code/README.md", shared: true}
    - {file: "harness:contexts/code/shared/README.md", shared: true}
    - {file: "harness:contexts/code/shared/typing.md", shared: true}
    - {file: "harness:contexts/code/shared/loosening.md", shared: true}
    - {file: "harness:contexts/code/shared/comment.md", shared: true}
    - {file: "harness:contexts/code/shared/naming.md", shared: true}
    - {file: "harness:contexts/code/shared/imports.md", shared: true}
    - {file: "harness:contexts/code/shared/test.md", shared: true}
    - file: "harness:contexts/code/{side}/README.md"
      when: {side: [be, fe]}
    - file: "harness:CONTRIBUTING.md"
      when: {side: [harness, package]}
    - file: "harness:contexts/harness/cli-sections.md"
      when: {side: harness}
    - file: "harness:contexts/authority/branch.md"
      when: {side: harness}
    - file: "harness:packages/README.md"
      when: {side: package}
    - file: "harness:contexts/authority/packages.md"
      when: {side: package}
input:
  base:
    side: the side the task writes, be (the NestJS back end), fe (the Next.js front end) harness (this harness repository itself) or package (one `@starci` package of this harness, named by the `package` input, on its package edit branch)
    edition: the app's edition, `edition` of its hfs.json (lite or full; full when absent); harness for a harness or package task
output:
  base:
    summary: {type: string, summary: "what you changed and why"}
    files: {type: "string[]", summary: "the repository paths you changed"}
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the rules the code follows, from the side's files and the topics the contract adds (never the shared files)"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records the code implements"}
    cites: {type: "string[]", minItems: 0, summary: "the anchor ids you decided by: a Choose anchor (<family>.choose[.<term>]) per Grammar component family you import, plus the DNA and rule ids (R<n>) you applied"}
checks:
  base: [check-run-green, paths-only, rules-cited, anchors-cited]
  behavioural: true
---
Write the code of the slice and the tests that prove what it changed, in the slots the anatomy slice of your side and edition
gives and the patterns of the topics you read. Code traces to its Work records and never redefines them: a record that is
wrong or missing is a `mismatch`, not a guess.

Before you pick a Grammar component, variant, intent or spacing step, search for its Choose section (`starci contexts
search "<need>" --scope ui`) and read it; decide by it, then list under `cites` the Choose anchor of every component family
your files import (`tabs.choose`, or a finer `tabs.choose.<term>`), the DNA and rule ids you applied, and every id the
contract hands you. A family you import with no Choose anchor cited, or an id that resolves to nothing, is red
(`anchors-cited`); the reviewer then grades each cite against your diff.
