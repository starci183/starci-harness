---
name: claude-design
description: >-
  Draw an app's gallery before code, the StarCi way: every page of an area and each of its states as a gallery screen at
  1440 and 390, each with its explain.md as the note, composed from the page's real business (its backend operations,
  fields, states, permissions) and the app's Grammar only, never copied from the old screen. One Opus lead and up to ten
  Sonnet lanes draw it into the app's .starcistacks/canvas/, a node assembler builds the board, an Artifact publishes it,
  and design.json tracks each screen from drafted to approved, built and matches. Required before any UI change of a StarCi app (canvas first, then code, then gallery). Use on an explicit /claude-design
  request, or when the owner asks to "vẽ mockup", "vẽ lại trang", "canvas mockup" or "claude design" for a StarCi app.
disable-model-invocation: true
triggers: [user]
---

# claude-design

The design pass is the app's gallery drawn before code. Where the canvas lives, how its screens map onto the gallery
(ids, the eight states, the sizes), the note being the screen's `explain.md`, the lifecycle drafted → approved → built →
matches with who sets each status, and what `starci app check` judges are owned by
[PROJECT-GALLERY-6](../../contexts/project/gallery.md#project-gallery-6-an-area-can-be-drawn-before-code-the-design-canvas-mirrors-the-gallery-and-records-each-screens-approval).
This skill owns how a screen is designed and how the board is produced.

## When to use it

Every UI change, not only a new area: any change a user can see (a redesign, a fix round, a moved region, a changed state or copy) starts here, on the
screen's canvas page, before its code. The order is canvas, code, gallery, and [PROJECT-GALLERY-7](../../contexts/project/gallery.md#project-gallery-7-a-ui-change-goes-board-first-then-code-then-the-gallery-then-one-review) owns it and its check
(`HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED`). A change to an existing page redraws or adjusts its page and concept note; the owner approves; only then is it coded.

The canvas is a quick sketch: it fixes the direction (regions, the one primary action, the states), not a deep analysis, so a lane does not
compare it with other products or weigh every alternative. That weighing happens after the code, in the final critique of PROJECT-GALLERY-7 item 3,
by an agent other than the builder, in two rounds (the 1440 composition against real products of the same archetype; then the 390 frame and the
empty, loading and error states). Its record, the section "Phương án đã cân nhắc" in the screen's `explain.md` and the canvas page's note, is what
makes a screen final; the brief is in [references/production.md](references/production.md#the-final-critique-another-agent-after-code).

## Method

Read the app's `.starcistacks/brand/` first ([PROJECT-BRAND-3](../../contexts/project/brand.md#project-brand-3-a-design-or-image-brief-reads-the-brand-folder-first)): its colour token names, voice and illustration concept bound every frame, and an illustration is prompted as its basePrompt plus a subject.

A page is designed from exactly two inputs, and the drawer composes the best UX from them:

1. **The business, read from the code.** The page's real backend operations (GraphQL or REST resolvers, commands,
   queries, by their names in the code), the fields they read and write, the states a record goes through, and who may do
   what (permissions, approvals). Read the app's `be/` contracts, resolvers and domain services and its
   `.starciwork/concepts`. The current `fe/` page and its gallery shots only tell which jobs exist; their layout is never
   copied or redrawn.
2. **The Grammar.** Only its elements, kinds, slots and tokens: `contexts/ui/components/<role>.md`, the installed
   `@starci/grammar`, the app's `hfs.json` (`sides.fe.grammar`) and its brand.css theme hooks, in the reading order of
   [the starci skill's UI reference](../starci/references/ui-on-grammar.md).

Two gaps never stop the drawing and are never a question for the owner:

- **A Grammar element the UX needs and the Grammar lacks** is drawn anyway, marked `cần Grammar: <what>` in the frame and on
  that region's `Grammar:` line of the note, and listed in the lane report as a Grammar request.
- **A backend operation, query or field the page needs and the code lacks** is drawn as if it existed, named
  `cần API: <operation>` in the note's introduction beside the operations that exist, and listed in the lane report; it is
  built when the page is coded, inside that page's build slice.

Only a real business choice (what the business wants) goes to the owner. Each note names the real operations the
screen uses and the Grammar elements that draw it.

## The look

The frames carry the app's current Grammar look, never a free style:

- A white theme is #fff with 1px hairlines; lists and tables lie flat on the surface with hairline rows; a card only for
  a real object (a customer, an agent, a provider, a dialog), never as a section frame.
- A page head band with the title, a facts line and the **one** primary action; one red pill primary per view, every
  other button neutral.
- Tabs: the selected one in the brand colour (text and underline), counts on tabs, overflow in "+n".
- Badges carry meaning: waiting amber soft, done or verified green soft, neutral gray soft, danger red soft.
- Inline links underlined; a checked checkbox in the brand colour; a visible off track on a switch; a disabled button
  says why.
- Natural Vietnamese UI copy with real sample data (names, amounts in đ, dates dd/mm/yyyy), a strong type hierarchy
  and generous whitespace; no external images (inline SVG, initials avatars).

[references/format.md](references/format.md) has the markup of a page fragment, its frames and its note.

## Production

One **Opus lead** and up to **ten Sonnet lanes**, in the app's `.starcistacks/canvas/`:

1. The lead reads the app (its routes, `be/` operations, `.starcistacks/canvas/design.json` and the gallery ids), copies
   the kit (`canvas.css` from [kit/](kit/), `tokens.css` written from the app's brand.css and Grammar roles) and writes one
   brief per page in `briefs/<NN>-<slug>.md`.
2. Each lane draws **one page**, `pages/<NN>-<slug>.html`: one section per screen of the page (its base screen and each
   state), each with its 1440 and 390 frames and its note. Lanes run in parallel, one page each.
3. The assembler [kit/build.mjs](kit/build.mjs) joins the fragments in `NN` order into `<app>-design.html`.
4. The lead reviews the board at full size, fixes what breaks the one product, sets each drawn screen `drafted` in
   `design.json`, publishes the board as an Artifact and records its link as `board`.
5. The lifecycle then runs as PROJECT-GALLERY-6 item 5 says: the lead sets `approved` on the owner's "đẹp" for a page,
   the code lane builds and shoots it and sets `built`, the lead or a reviewer compares and sets `matches`.

[references/production.md](references/production.md) has the brief template, the lane prompt, the assembler's
contract, the review checklist and each lifecycle step's commands.

## Done means

The Artifact link to the board and the committed canvas; per page, the screens drawn and the states left out with the
reason; the `cần Grammar` and `cần API` items; the business questions for the owner. A fix round redraws only the pages
the owner names, and a redrawn approved screen returns to `drafted`.
