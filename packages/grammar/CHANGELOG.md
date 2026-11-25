# Changelog

Versioned history starts at beta; earlier history is in git.

## 0.59.1 - 2026-11-25

- Fixed (h-overlay-description-div): the `description` of `Dialog`, `AlertDialog` and `Drawer` is drawn in a `div` (was a `p`), so block content (a status line, a row) is valid HTML; it stays the overlay's `aria-describedby`.

## 0.59.0

- The StarCi Grammar: React components, compositions and packaged visual DNA.
- Chat has one look: `ChatFrame` is the one chat on a `Pane content="chat"`, a `Drawer` body or a page section; an incoming message is the flat surface, an outgoing one the accent, on every bubble, with no theme hook to repaint them.
- Manual steps: put a chat in `<Pane content="chat"><ChatFrame ...></Pane>` with the composer as the frame's `footer`; drop `tone` from `MessageBubble` and `MessageCard`, and `role` and `scrollRef` from `PaneSection scroll`; drop the `--starci-core-bubble-*` and `--starci-core-message-card` theme hooks.
