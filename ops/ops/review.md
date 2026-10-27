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
checks:
  base: [paths-only, result-passed, rules-cited]
  behavioural: false
---
Read `git diff <since>..HEAD` of the paths the contract names against the contracts and Work records in your context and
the rules of the topics it adds. Each place the diff breaks a rule or a record, or does what no record asks, is a finding
naming the file, the line, the rule or record and the problem; any finding makes the verdict failed (file `failed`).
Change nothing: the build that made the diff repairs it. The router gives this task a provider that did not author the work
it reads (`independentOf`).
