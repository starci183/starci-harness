---
schema: starci/op@1
summary: draw or revise the one design board of an app (every screen in every named state at 1440 and 390, Grammar components and the app's tokens only), one task per app or per board revision
floor: hard
hostTools: [git, node]
supersedes: [draw, image]
masterPlan: [ui]
context:
  budget: 40000
  base:
    - harness:contexts/project/work-sections.md
    - harness:contexts/project/gallery.md
    - harness:contexts/ui/README.md
    - harness:contexts/ui/composition-sections.md
    - harness:contexts/ui/scale.md
    - harness:contexts/grammars/contract-sections.md
    - harness:contexts/grammars/{grammar}.md
input:
  base:
    grammar: the grammar the app composes, `sides.fe.grammar` of its hfs.json (core or offset-pop)
    revision: the board revision this task draws, `revision` of `gallery/board/board.yaml` after the task (the current one plus 1 for a change the owner has not seen)
output:
  base:
    summary: {type: string, summary: "what the board revision draws and the choices it settles"}
    files: {type: "string[]", summary: "the repository paths you changed: gallery/board/board.yaml and the section modules"}
    sections: {type: "string[]", minItems: 1, summary: "the section ids (<area>/<screen>) this revision drew or changed"}
    needsApi: {type: "string[]", summary: "every \"cần API\" operation the board marks, for the build slices"}
    rulesApplied: {type: "string[]", minItems: 1, cites: context, summary: "the ids of the gallery, ui and grammar rules the board follows"}
    workRecords: {type: "string[]", minItems: 1, cites: work, when: work, summary: "the ids of the Work records the board follows (the brand, the concepts)"}
    cites: {type: "string[]", minItems: 1, summary: "the anchor ids you decided by: the Choose anchor (<family>.choose[.<term>]) of every component family the board composes, plus the DNA and rule ids you applied"}
checks:
  base: [check-run-green, paths-only, rules-cited, anchors-cited]
  behavioural: false
---
Draw the app's board as [PROJECT-GALLERY-9](../../contexts/project/gallery.md#project-gallery-9-one-design-board-per-app-drawn-once-from-the-grammar)
says: `gallery/board/board.yaml` lists every screen of the app as a section (its gallery id, title, route, named states from `default`, its
"cần API" marks, `planned: true` until its route is coded) and each section is its module `gallery/board/<area>/<screen>.tsx`, whose default
export draws the screen in the state it is given, composed only of the Grammar's components with the data the screen really shows. A
revision is one task: it raises `revision`, drops `approvedAt` (only the owner's words set it again) and touches only the sections it
changes, every other section kept as it is. A missing API is drawn as the right UX and marked, never asked about; a colour, typeface or
mark the brand does not settle, or a shape the Grammar cannot render, is `blocked` naming the gap ("cần Grammar"), never a class or a
component of the board's own.

Before you place a component, search for and read its Choose section (`starci contexts search "<need>" --scope ui`) and pick the role,
variant, intent and spacing step it gives; list under `cites` the Choose anchor of every component family the board imports, the DNA
and rule ids you applied, and every id the contract hands you (`anchors-cited` reads the section modules' Grammar imports itself). The
code that copies the board, and the one review of the gallery, are graded against these cites.

`check-run-green` runs the app check over the board, so the record's shape, the module of every section, every coded route on the
board and every section on a coded route or marked planned (R395, `HFS_APP_GALLERY_BOARD_*`) hold before you file. Look at the board in
the gallery (`#/board`, the gallery dev server) at full size before you file, 1440 and 390 of every state you drew. The owner approves the
revision once, on the board; the code copies it afterwards.
