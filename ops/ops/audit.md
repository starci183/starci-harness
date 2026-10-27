---
schema: starci/op@1
summary: walk the implemented screens against their ui record and the grammar with screenshots, read-only, and report the drift as findings
floor: medium
hostTools: [browser]
context:
  budget: 40000
  base:
    - harness:contexts/project/work.md
    - harness:contexts/ui/README.md
    - harness:contexts/ui/composition.md
    - harness:contexts/ui/scale.md
    - harness:contexts/grammars/contract.md
    - harness:contexts/grammars/{grammar}.md
input:
  base:
    grammar: the grammar the app composes, `sides.fe.grammar` of its hfs.json (core or offset-pop)
    run: the run folder the walk writes (git-ignored), the task's only allowPath
output:
  base:
    summary: {type: string, summary: "the screens and states you walked and how they compare"}
    files: {type: "string[]", summary: "the script and evidence files you wrote"}
    verdict: {type: string, summary: "passed when every screen matches its direction and the grammar, else failed"}
    findings: {type: array, summary: "one entry per drift: {screen, state, expected, observed, screenshot, rule}"}
    rulesApplied: {type: "string[]", minItems: 0, cites: context, summary: "the ids of the ui and grammar rules a finding breaks"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the ui and impl records you audited"}
    cites: {type: "string[]", minItems: 0, summary: "the anchor ids you judged by beyond the handed ones: Choose anchors (<family>.choose[.<term>]), DNA and rule ids"}
    citeGrades: {type: array, minItems: 0, summary: "one entry per cite the contract hands you (the author's): {cite, grade: followed | violated | not-applicable, evidence: one line}"}
checks:
  base: [paths-only, result-passed, rules-cited, anchors-cited]
  behavioural: false
---
Write a short Playwright script that opens each screen of the records in every state they name and saves a screenshot per
screen and state, and run it with `starci uat run <script> --out <run>`, so each screenshot is held by the run's receipt.
Compare each screenshot with the record's direction and the grammar's rules; each difference is a finding with its
screenshot and the rule it breaks, and any finding makes the verdict failed (file `failed`). Change nothing in the product.
A direction that is missing, contradictory or too vague to audit against is no finding of the build: file `blocked`
naming it, and the Kernel redraws.

The contract's `cites` are the author's (the draw and code of the screen): the brief's "Cites" section quotes each with the
text it resolves to. Grade every one under `citeGrades` against the screenshots: `followed`, `violated` or
`not-applicable`, each with one line of evidence naming the screen, state and screenshot. A `violated` grade is a finding:
your verdict is failed and the code repairs it (`audit-drift-repairs-code`); `anchors-cited` is red on any `violated`.
