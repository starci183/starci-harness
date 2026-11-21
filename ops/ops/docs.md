---
schema: starci/op@1
summary: documentation and product content
floor: easy
hostTools: [git]
masterPlan: [business, domains]
context:
  base:
    - harness:contexts/project/work.md
input:
  base: {}
output:
  base:
    summary: {type: string, summary: "what you wrote or changed"}
    files: {type: "string[]", summary: "the documents you changed"}
checks:
  base: [paths-only]
  behavioural: false
---
Write present-tense prose that states what is true now, one fact in its one owning file, and records in the shape their
family defines. Replace the sentence that holds a rule; never append a second one beside it.
