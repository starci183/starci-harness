---
schema: starci/op@1
summary: one read-only review of a change, the diff against its contracts and Work records and, when it changes what a screen shows, the whole gallery against the board in one critique and audit pass; report structured findings
floor: medium
hostTools: [git, browser]
supersedes: [review, audit]
masterPlan: [business, tech, patterns, ui, data, testing, security, observability, domains]
independentOf: [code, design, prove]
context:
  budget: 40000
  base:
    - harness:contexts/project/work.md
    - harness:contexts/project/gallery.md
    - {file: "harness:contexts/code/README.md", shared: true}
    - {file: "harness:contexts/code/shared/README.md", shared: true}
    - file: "harness:contexts/ui/composition-sections.md"
      when: {scope: [ui, both]}
    - file: "harness:contexts/grammars/contract-sections.md"
      when: {scope: [ui, both]}
    - file: "harness:contexts/grammars/{grammar}.md"
      when: {scope: [ui, both]}
input:
  base:
    since: the commit the reviewed work started from; the diff is `git diff <since>..HEAD` over the task's context
    scope: what the review reads, `code` (the diff alone), `ui` (the gallery against the board) or `both` (a change that shows on a screen)
    grammar: the grammar the app composes, `sides.fe.grammar` of its hfs.json (core or offset-pop)
output:
  base:
    summary: {type: string, summary: "what you read and walked, and what you found"}
    files: {type: "string[]", summary: "the screen.yaml audits and evidence files you wrote, if any"}
    verdict: {type: string, summary: "passed when the diff meets its contracts and records and every screen matches the board and the grammar, else failed"}
    findings: {type: array, summary: "one entry per finding: {file, line, screen, state, rule, record, problem, screenshot}, the keys that apply"}
    screens: {type: "string[]", summary: "the gallery screens the pass covered: every screen the change reaches, empty for a code-only scope"}
    rulesApplied: {type: "string[]", minItems: 0, cites: context, summary: "the ids of the rules a finding breaks"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records you read the diff against"}
    citeGrades: {type: array, minItems: 0, summary: "one entry per cite the contract hands you (the author's): {cite, grade: followed | violated | not-applicable, evidence: one line}"}
checks:
  base: [paths-only, result-passed, rules-cited, anchors-cited]
  behavioural: false
---
One review per change, by a provider that wrote none of it (`independentOf`). Change nothing in the product: the build that made the
change repairs what you find (`inspect-findings-repair-build`).

**The diff** (scope `code` or `both`). Read `git diff <since>..HEAD` of the paths the contract names against the contracts and Work records
in your context and the rules of the topics it adds. Each place the diff breaks a rule or a record, or does what no record asks, is a
finding naming the file, the line, the rule or record and the problem.

**The gallery** (scope `ui` or `both`), once for the whole change, never screen by screen. The screens to cover are every screen the change
reaches: `starci app check --gate uiaudit` lists them (a screen is touched when its route's page reaches a changed file through imports,
PROJECT-GALLERY-8 item 3). Shoot them at 1440 and 390 from the code, then run the critique and the audit of
[PROJECT-GALLERY-7](../../contexts/project/gallery.md#project-gallery-7-a-ui-change-goes-board-first-then-code-then-the-gallery-then-one-review)
over all of them in each round: round 1 the desktop compositions against the board and real products of the same archetype, round 2 the
390 frames and every state, each round all seven lenses of every touched screen's `screen.yaml` (`starci audit run <area>/<screen>` opens
the round and prints the crops; you fill it). A screen that differs from its board section is a finding with its screenshot and the rule
it breaks; a board section that is missing, contradictory or too vague to judge is no finding of the build: file `blocked` naming it, and
the board is redrawn (`inspect-systemic-redesigns`).

Any finding makes the verdict failed (file `failed`). The contract's `cites` are the author's (the design and the code): the brief's
"Cites" section quotes each with the text it resolves to. Grade every one under `citeGrades` against the diff and the screenshots:
`followed`, `violated` or `not-applicable`, each with one line of evidence naming the file and line, or the screen, state and screenshot.
A `violated` grade is a finding; `anchors-cited` is red on any `violated`.
