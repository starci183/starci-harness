---
schema: starci/op@1
summary: scaffold, implement, fix, refactor or remove a feature
floor: medium
hostTools: [git, node]
masterPlan: [patterns, data, ui, domains]
perRecord: true
context:
  budget: 24000
  base:
    - file: "harness:contexts/project/anatomy-{side}.md"
      when: {side: [be, fe]}
    - file: "harness:contexts/project/edition.md"
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
    cites: {type: "string[]", minItems: 0, summary: "the anchor ids you decided by: a Choose anchor (<family>.choose[.<term>]) per Grammar component family you import, plus the DNA and rule ids (R<n>) you applied"}
checks:
  base: [check-run-green, paths-only, anchors-cited]
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

A slice that changes what a screen shows copies an approved drawing:
[PROJECT-GALLERY-7](../../contexts/project/gallery.md#project-gallery-7-a-ui-change-goes-board-first-then-code-then-the-gallery-then-one-review). In an
app with a design board (`gallery/board/board.yaml`) that is the screen's board section in a revision the owner approved (`approvedAt`): build
each state the section draws with the same Grammar components, then drop the section's `planned` mark once its route is coded. In an app
with a canvas it is the screen's canvas page (`design.json` page `approved`, then `built` with the change). When the drawing is not
approved, the slice is `blocked` naming it; you never draw or approve it yourself.

A slice that changes a screen ends with its shots at 1440 and 390 in the gallery. In an app with a board, the one review of the whole gallery
(the `inspect` op) audits it with every other screen the change reaches; in an app without one, a UI audit of
[PROJECT-GALLERY-8](../../contexts/project/gallery.md#project-gallery-8-one-file-per-screen-screenyaml-audited-until-it-first-passes) is optional: a local UX/UI helper (`starci audit run <area>/<screen> --builder <you>`, an auditor subagent other than you fills the lenses), never a gate. `UI_AUDIT_*` are info findings of `--env local`, a to-do list; nothing about an audit refuses a commit, a push or a release (owner, 2026-11-27).
