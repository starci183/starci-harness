---
schema: starci/op@1
summary: "superseded by design (one board per app, PROJECT-GALLERY-9), kept for the trial: generate real artwork (the artwork slots a drawn direction leaves, illustrations, mockup renders)"
floor: hard
hostTools: [git]
perRecord: true
context:
  base: []
input:
  base: {}
output:
  base:
    summary: {type: string, summary: "what you generated and for what"}
    files: {type: "string[]", minItems: 1, summary: "the image files you wrote, under allowPaths"}
checks:
  base: [paths-only]
  behavioural: false
---
Generate each image the contract asks for and write it under the contract's allowPaths, in the format and size it names;
for an artwork slot a drawn direction leaves, write the file at the path the contract names for it. An image never carries a secret, a real
person's likeness, or another brand's mark. Name what each file shows in your summary.
