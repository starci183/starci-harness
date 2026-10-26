---
schema: starci/op@1
summary: documentation and product content
floor: easy
hostTools: [git]
context:
  base:
    - harness:knowledge/project/work.md
input:
  base: {}
output:
  base:
    summary: {type: string, summary: "what you wrote or changed"}
    files: {type: "string[]", summary: "the documents you changed"}
    rulesApplied: {type: "string[]", minItems: 0, cites: context, summary: "the ids of the writing or record rules you applied"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records you wrote or changed"}
  behavioural: false
checks:
  base: [paths-only, rules-cited]
  behavioural: false
---
Write present-tense prose that states what is true now, one fact in its one owning file, and records in the shape their
family defines. Replace the sentence that holds a rule; never append a second one beside it.
