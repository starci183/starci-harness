---
schema: starci/op@1
summary: walk the flows with `starci uat run` (Playwright in Docker), one screenshot per step into the evidence folder
floor: medium
hostTools: [browser]
context:
  base:
    - harness:knowledge/project/work.md
    - harness:knowledge/project/stacks.md
input:
  base: {}
output:
  base:
    summary: {type: string, summary: "the flows walked and what the product did"}
    files: {type: "string[]", summary: "the script and evidence files you wrote"}
    verdict: {type: string, summary: "passed when every step behaved as the flow says, else failed"}
    steps: {type: array, summary: "one entry per step, with its screenshot"}
  behavioural: true
checks:
  base: [result-passed]
  behavioural: true
---
Write a short Playwright script for the flows and run it with `starci uat run`; never install Playwright or a browser, and
never run Docker by hand. A step where the product misbehaves is a failed verdict with its screenshot, never a script
changed until it passes.
