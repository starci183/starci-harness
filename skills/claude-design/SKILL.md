---
name: claude-design
description: >-
  Draw a product mockup the StarCi way: a grey canvas of labelled frames, one frame per screen state at
  exactly 1440 and 390, every page with all its states and one yellow concept note, drawn on the app's
  current Grammar with a shared kit.css, by one Opus lead and up to ten Sonnet lanes, assembled by a node
  script and published as an Artifact. Use on an explicit /claude-design request, or when the owner asks
  to "vẽ mockup", "vẽ lại trang", "canvas mockup" or "claude design" for a StarCi app.
disable-model-invocation: true
triggers: [user]
---

# claude-design

A mockup that the owner reads like a design board: every page, every state, both sizes, and in one note why the
page is drawn that way. It is a redesign of the page's job, never a copy of the current screen: the owner fixes the
business, the drawer fixes the design.

## The format (exact)

- **One grey canvas**, frames laid out in rows: one row per page, its states left to right.
- **One frame = one screen state at one width.** The label above it is `<Trang>, <trạng thái> · 1440` or
  `<Trang>, <trạng thái> · 390`. Exactly two widths: 1440 (desktop) and 390 (phone); never 1920, 768 or other.
- **Every page draws all of its states**: the eight states of the state table in [references/format.md](references/format.md#states)
  (danh sách to đang soạn), in its order. A state that cannot happen on the page is left out, and the concept note says
  so in one clause.
- **One yellow sticky note per page**, at the start of the page's row, titled `Concept: <Trang>`, one dense
  paragraph in this order: **Mục tiêu** (the business job of the page, in the owner's words) → **bố cục** (list /
  detail split and why) → **hành động chính** (the single primary action) → **lọc** (how filtering and search work)
  → **Khác bản hiện tại:** (what changes against the current screen) → **Lưu ý xung đột:** (which decision the
  drawing follows where two sources disagree, and the source of each).

[references/format.md](references/format.md) has the canvas geometry, the label and note markup and a worked
example of a note.

## Drawn on the app's Grammar

The frames are drawn with the app's current Grammar look, never a free style:

- Read the app's `hfs.json` (`sides.fe.grammar`), its brand.css (the theme hooks it sets) and the installed
  `@starci/grammar` version, then [the starci skill's UI reference](../starci/references/ui-on-grammar.md) for the
  reading order of `contexts/ui` and `contexts/grammars`.
- A white theme is #fff with hairlines; cards only for real objects (a record, a message, a file), never as a page
  section frame; **one** red primary action per frame; badges carry meaning (status, count), never decoration.
- Component names, props and states are the Grammar's (`contexts/ui/components/<role>.md`); a capability the
  Grammar lacks is noted in the concept as a gap, never invented.

## Production

One **Opus lead** and up to **ten Sonnet lanes**:

1. The lead reads the app (routes, `.starciwork/concepts`, the gallery shots of the current screens, the owner's
   business notes) and writes `kit.css` (the one shared stylesheet: canvas, frame, label, note, and the Grammar
   look as CSS custom properties taken from the app's brand.css) and one brief per page in `briefs/<page>.md`
   (the page's job, its states, its primary action, its data, the conflicts and how to settle them).
2. Each lane draws **one page fragment**, `pages/<page>.html`: the page's note and all its frames at both widths,
   only with the classes of `kit.css`, never its own colours or sizes. Lanes run in parallel, one page each.
3. A node script assembles the fragments in page order into one `index.html` (kit inlined, fragments in rows) and
   refuses a fragment that writes a colour, a px length or a `<style>` of its own.
4. The lead reviews the assembled board at full size, fixes what breaks the one product (a second primary, a card
   used as a frame, a missing state, a label not in the format) and publishes it as an Artifact.

[references/production.md](references/production.md) has the folder layout, the brief template, the lane prompt,
the assembler's contract and the review checklist.

## Done means

The Artifact link to the board; per page, the states drawn and any left out with the reason; the conflicts the
notes settle; and the Grammar gaps found. The owner reviews the business; a fix round redraws only the pages it names.
