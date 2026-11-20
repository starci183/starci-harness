---
schema: starci/op@1
summary: prove one slice by the suite that judges it (e2e on a fresh database first, the specs it needs inside test paths only) and report the run as json; the harness reruns the suite to judge the report
floor: medium
hostTools: [git, node, docker]
supersedes: [test, verify]
context:
  budget: 30000
  base:
    - harness:contexts/project/anatomy-be.md
    - harness:contexts/project/lint.md
    - {file: "harness:contexts/code/README.md", shared: true}
    - {file: "harness:contexts/code/shared/README.md", shared: true}
    - {file: "harness:contexts/code/shared/test.md", shared: true}
    - harness:contexts/code/be/test.md
    - harness:packages/jest-preset/README.md
input:
  base:
    suite: the command that runs the suite in the contract's cwd (argv split on spaces, no shell); the harness reruns it on the clean checkout
output:
  base:
    summary: {type: string, summary: "what the suite proves, what ran and what it found"}
    files: {type: "string[]", summary: "the spec and report files you wrote, under test paths only"}
    verdict: {type: string, summary: "passed or failed, as the suite itself judged (its exit code: 0 is passed)"}
    findings: {type: array, summary: "one entry per failure or finding, empty when there is none"}
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the testing rules the suite follows, from the back-end test topic (never the shared files)"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records the suite proves"}
checks:
  base: [paths-only, rules-cited, suite-verdict, result-passed]
  behavioural: true
---
The proof of a slice is the suite that runs it end to end: the app on a fresh database, real events in, every row checked, the third
parties faked at the network edge (BE-TEST-12, BE-TEST-17). Write only what the suite needs, inside test paths (a spec of the world the
slice touches, a builder, a fixture), and no new unit spec while the app is built code first; never change product code and never weaken
an assertion to make it pass. Then run the suite the input names once it is set up as the input says, through the replay or, for specs
calling `useSandbox`, `starci test live` (the worker procedure, step 3), never by its own command.

Report what the suite found. A red suite is a finding, filed `failed` with `verdict: failed` and its findings, not a reason to edit code:
the build repairs it (`prove-red-repairs-build`). A report showing `TEST_WORLD_NOT_DECLARED` or a custody refusal is no finding about the
product: the harness judges it by its own run with custody. The task is green only when the suite passed on the clean checkout and your
verdict says so; a verdict that run contradicts is red too. An integration or e2e suite runs because this task asks for it, never from a
hook or a default gate ([contexts/project/cicd.md](../../contexts/project/cicd.md) "Triggers and what runs").
