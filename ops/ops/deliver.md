---
schema: starci/op@1
summary: publish, deploy or migrate one target and probe it live
floor: hard
hostTools: [git, node, docker]
context:
  base:
    - harness:contexts/project/stacks.md
input:
  base:
    target: the one target to publish, deploy or migrate (a package, an environment or a database)
output:
  base:
    summary: {type: string, summary: "what was delivered and how it was probed"}
    files: {type: "string[]", summary: "the repository paths you changed, if any"}
    target: {type: string, summary: "the target as it was delivered (version, url or migration id)"}
checks:
  base: []
  behavioural: true
---
Deliver exactly the target of the input with the harness verbs and the stack's own operations, then probe it live. The
contract is the owner's approval for that target alone; anything beyond it is `blocked`.
