---
schema: starci/op@1
summary: run one heavy suite the goal asks for (perf, security, e2e) and report it as json
floor: medium
hostTools: [git, node, docker]
context:
  base:
    - harness:contexts/project/lint.md
input:
  base: {}
output:
  base:
    summary: {type: string, summary: "what ran and what it found"}
    files: {type: "string[]", summary: "the report files you wrote, if any"}
    suite: {type: string, summary: "the command that ran the suite"}
    verdict: {type: string, summary: "passed or failed, as the suite itself judged"}
    findings: {type: array, summary: "one entry per failure or finding, empty when there is none"}
  behavioural: true
checks:
  base: []
  behavioural: true
---
Run the suite the input names, once it is set up as the input says, and report what it found. Do not fix what it finds:
a red suite is a finding, reported with `verdict: failed`, not a reason to edit code.
