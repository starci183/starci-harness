---
schema: starci/op@1
summary: walk the flows with `starci uat run` (Playwright in Docker); the script records checks.json and one screenshot per step, under the run's receipt
floor: medium
hostTools: [browser]
context:
  base:
    - harness:contexts/project/work-sections.md
    - harness:contexts/project/stacks-sections.md
input:
  base:
    record: the Work record of the flow (`.starciwork/features/<feature>/uat/<flow>/index.yaml`)
    run: the run folder the walk writes (`<flow folder>/runs/<run id>`, git-ignored), the task's only allowPath
output:
  base:
    summary: {type: string, summary: "the flows walked and what the product did"}
    files: {type: "string[]", summary: "the script and evidence files you wrote"}
    verdict: {type: string, summary: "passed when every step behaved as the flow says, else failed"}
    steps: {type: array, summary: "one entry per step, as the script wrote it in checks.json"}
checks:
  base: [uat-flow]
  behavioural: true
---
Write a short Playwright script for the flows and run it with `starci uat run <script> --out <run>`; never install
Playwright or a browser, and never run Docker by hand. The script itself observes: during the run it saves each step's
screenshot (`page.screenshot`) and writes `checks.json` with every step's status and the value it read for each check.
The harness judges the walk on those files as the run's receipt holds them, so a file written or edited outside the run
counts for nothing. A step where the product misbehaves is a failed verdict with its screenshot, never a script changed
until it passes.
