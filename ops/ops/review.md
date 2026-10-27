---
schema: starci/op@1
summary: read the diff of a slice against its contracts and Work records, read-only, and report structured findings
floor: medium
hostTools: [git]
independentOf: [code, test]
context:
  budget: 30000
  base:
    - harness:contexts/project/work.md
    - {file: "harness:contexts/code/README.md", shared: true}
    - {file: "harness:contexts/code/shared/README.md", shared: true}
input:
  base:
    since: the commit the reviewed work started from; the diff is `git diff <since>..HEAD` over the task's context
output:
  base:
    summary: {type: string, summary: "what you read and what you found"}
    files: {type: "string[]", summary: "the files you wrote, if any"}
    verdict: {type: string, summary: "passed when the diff meets its contracts and records, else failed"}
    findings: {type: array, summary: "one entry per finding: {file, line, rule, record, problem}"}
    rulesApplied: {type: "string[]", minItems: 0, cites: context, summary: "the ids of the rules a finding breaks"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records you read the diff against"}
    citeGrades: {type: array, minItems: 0, summary: "one entry per cite the contract hands you (the author's): {cite, grade: followed | violated | not-applicable, evidence: one line}"}
checks:
  base: [paths-only, result-passed, rules-cited, anchors-cited]
  behavioural: false
---
Read `git diff <since>..HEAD` of the paths the contract names against the contracts and Work records in your context and
the rules of the topics it adds. Each place the diff breaks a rule or a record, or does what no record asks, is a finding
naming the file, the line, the rule or record and the problem; any finding makes the verdict failed (file `failed`).
Change nothing: the build that made the diff repairs it. The router gives this task a provider that did not author the work
it reads (`independentOf`).

The contract's `cites` are the author's: the brief's "Cites" section quotes each with the text it resolves to. Grade every
one under `citeGrades` against the diff: `followed` (the diff does what the cited text asks), `violated` (it does not), or
`not-applicable` (the diff never touches what it governs), each with one line of evidence naming the file and line. A
`violated` grade is a finding like any other: your verdict is failed and the build repairs it
(`review-findings-repair-build`); `anchors-cited` is red on any `violated`, so it never passes as green.
