# Lesson parts: CodeBlock, GradedChoice, Sidenotes, TableOfContents

No contract role yet: these are the parts of a lesson page (owner 2026-11-23), each a Grammar component an app places; their look is the
Grammar's (`src/common/components-lesson.css`), their words the app's. Diagrams are [diagram](diagram.md) (`MermaidDiagram` of the graph ext, on the graph canvas); the prose roles are
[text](text.md) (`reading.title`, `reading.body`).

## Job
Teach on one page: show the code a lesson is about, ask a question the learner answers until right, explain the terms of the prose beside it,
and let the reader move through a long part.

## Choose

Choice `lesson.choose.code`: how code stands on the page. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| article | the code is a fence inside a markdown body | `Markdown` (its `FencedCodeBlock`), see [text](text.md) | judgement |
| excerpt | the code stands on its own: an excerpt of a file the lesson points at | `CodeBlock` with `path`, `start` (the file's own number of the first line), `highlightLines` by those numbers and a `note` saying what to notice | judgement |
| folded | the excerpt is reference the reader may skip (the lesson already said what it shows) | `CodeBlock` with `defaultCollapsed`: one row with the file, `lines 64–71 · 2 marked lines` and the badge | judgement |

Choice `lesson.choose.question`: how a lesson asks. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| graded | one right answer among a few, each answer with its reason | `GradedChoice` (`options` with `isCorrect` and `explanation`); a wrong pick locks with its reason and the learner picks again | judgement |
| form | the answer is typed, or several answers are right | not this part: a form ([field](field.md)) | judgement |

Choice `lesson.choose.terms`: how a term of the prose is explained. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| margin | the page has several terms a learner may not know, and a wide frame can hold a margin column | `Sidenotes` around the prose with `notes`, each term a `SidenoteTerm id` | judgement |
| inline | one or two terms, or a frame with no room for a margin (a card, a chat answer) | `GlossaryTerm` ([text](text.md)) | judgement |

Choice `lesson.choose.outline`: whether a long part carries an outline. A part of four or more titled sections taller than the screen takes a
`TableOfContents` in the column beside it (`items` are the sections' ids and names; `offset` is the height of a sticky bar above); a shorter part
takes none. Measure: judgement.

## Variants
- `CodeBlock`: `scheme` (`page` follows the page; `dark` or `light` sets the block in that theme whatever the page's, from the same tokens);
  `lineNumbers` (default on); `copyable` (default on). The fold is controlled (`isCollapsed`, `onCollapsedChange`) or uncontrolled
  (`defaultCollapsed`); without either the block has no fold.
- `GradedChoice`: `keys` (default A, B, C ...); `picks` with `onPicksChange` (controlled, e.g. a learner's saved answers) or `defaultPicks`.
- `Sidenotes`: the margin column from a 52rem frame; under it the fold `foldLabel(n)` ("Terms (3)") under the prose.

## Size
`GradedChoice` answers read at `reading.body` on a plate at least 68 high, the key a 32 round mark. `CodeBlock` code is 13 mono on the body line
(22), its header 48. The margin column is 16rem.

## States
- `CodeBlock`: loading (`isLoading`) keeps the frame and header, the code laid out unseen under a shimmer; folded; open.
- `GradedChoice` answer: open, wrong (danger soft plate with its edge, the verdict and the reason, locked), correct (success soft plate, the key
  filled, the verdict and the reason), spent (every answer still open once the right one is found: muted words, locked). Inside a loading
  region it waits inert.
- `Sidenotes`: a note is active while its term is hovered or focused (the accent edge on the note, the foreground underline on the term).
- `TableOfContents`: the section in view is active (foreground on the rail, `aria-current="location"`); inside a loading region it waits inert.

## Owner split
- **Grammar owns:** the plates, the verdicts and their tones; the code block's frame, gutter, band and fold; the margin column, the notes' places
  level with their terms and the fold; the outline's rail, scroll spy and jump (smooth unless reduced motion).
- **Knowledge decides:** the rows above.
- **App author decides:** the code and its file, the question, the answers and their reasons, the terms and notes, the sections, every word
  (`labels`, `foldLabel`, `title`).

## Accessibility
Each answer is a real button (Tab, the arrow keys, Home and End move; Enter or Space picks; a locked one is `aria-disabled`; the verdict is
announced politely). A `SidenoteTerm` is a button described by its note; a press brings the note into view (on a narrow frame it opens the
fold). The margin column is a named `complementary` landmark, the outline a named `navigation`. The code scrolls inline as a named region, a Tab
stop; its gutter numbers are never selected or copied, and Copy writes the code as written.

## Rules
OVERFLOW-4, STATE-7, STATE-8, FOCUS-1, A11Y-2. Stories `Content/Lesson page parts (0.55.1)`.
