# Changelog

Versioned history starts at beta; earlier history is in git.

## 0.59.2 - 2026-11-25

- Fixed (h-grammar-390): the action buttons of an `EmptyNotice` (the primary, the endArrow primary and the secondary) are `md`, the 40px control height, on every scope; they were `sm` (32px) in a region. The head of a `Section` wraps below 30rem (a 390px phone): the action slot drops under the title, at the start, instead of squeezing or cutting it.
- Fixed (h-grammar-next-010, the Next v0.0.10 UI audit): a scrolling tab strip reserves the width of each page control it shows, so the control never covers the edge tab's label at 390px, and the selected tab is revealed clear of it. `MermaidDiagram` opens a wide drawing fitted to its width whenever that stays readable (it no longer opens at 0.85 with its last node cut off), and a flowchart or state diagram too wide to read across its canvas is laid out top-down. The `ProportionBar` legend dot stands on the first line of a wrapping label. The `Disclosure` (and generic `Accordion`) trigger stands on the start edge of the content: the vendor indicator's `margin-inline-start: auto` no longer pushes the caret and the words to the far end.

## 0.59.1 - 2026-11-25

- Fixed (h-overlay-description-div): the `description` of `Dialog`, `AlertDialog` and `Drawer` is drawn in a `div` (was a `p`), so block content (a status line, a row) is valid HTML; it stays the overlay's `aria-describedby`.

## 0.59.0

- The StarCi Grammar: React components, compositions and packaged visual DNA.
- Chat has one look: `ChatFrame` is the one chat on a `Pane content="chat"`, a `Drawer` body or a page section; an incoming message is the flat surface, an outgoing one the accent, on every bubble, with no theme hook to repaint them.
- Manual steps: put a chat in `<Pane content="chat"><ChatFrame ...></Pane>` with the composer as the frame's `footer`; drop `tone` from `MessageBubble` and `MessageCard`, and `role` and `scrollRef` from `PaneSection scroll`; drop the `--starci-core-bubble-*` and `--starci-core-message-card` theme hooks.
