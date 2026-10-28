---
schema: starci/op@1
summary: run one suite of a lane (e2e, security, perf, an integration's live proof) and report it as json; the harness reruns it to judge the report
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
  base: [suite-verdict, result-passed]
  behavioural: true
---
Run the suite the input names, once it is set up as the input says, and report what it found. Do not fix what it finds:
a red suite is a finding, filed `failed` with `verdict: failed` and its findings, not a reason to edit code. The harness
reruns the same command on the clean checkout, a jest command scoped to the spec files it names by path (never a
live-provider suite it does not name), as your dry replay of the contract runs it: run the suite through that replay. The task
is green only when the suite passed and your verdict says so, and a verdict that run contradicts is red too.
