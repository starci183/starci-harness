---
schema: starci/op@1
summary: run one heavy suite the goal asks for (perf, security, e2e) and report it as json; the harness reruns it to judge the report
floor: medium
hostTools: [git, node, docker]
context:
  base:
    - harness:contexts/project/lint.md
input:
  base:
    suite: the command that runs the suite in the contract's cwd (argv split on spaces, no shell); the harness reruns it on the clean checkout
output:
  base:
    summary: {type: string, summary: "what ran and what it found"}
    files: {type: "string[]", summary: "the report files you wrote, if any"}
    verdict: {type: string, summary: "passed or failed, as the suite itself judged (its exit code: 0 is passed)"}
    findings: {type: array, summary: "one entry per failure or finding, empty when there is none"}
checks:
  base: [suite-verdict]
  behavioural: true
---
Run the suite the input names, once it is set up as the input says, and report what it found. Do not fix what it finds:
a red suite is a finding, reported with `verdict: failed`, not a reason to edit code. The harness reruns the same command
on the clean checkout; the task is green when your verdict agrees with that run, and red when it does not.
