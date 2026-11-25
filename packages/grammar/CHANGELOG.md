# Changelog

Versioned history starts at beta; earlier history is in git.

## 0.60.0 - 2026-11-26

- Changed (h-grammar-chat-avatars, NIVO feedback 2): a figure that is a link (`Section kind="figures"`) draws no chevron or arrow; the whole cell is the press target, shown by the pointer cursor and the row hover surface. `DNA-COMMON-FIGURE-LINK-CUE` now says so (it measures zero cue glyphs); `data-grammar-figure-cue` and `.starci-core-figure-cue` are gone.
- Added (feedback 3): `MessageFrame`, the one chat card for a structured message frame: the title, a status dot only for a real state, field and value rows, at most three actions (the first is the card's primary), a muted meta line, in the compact density (`MessageCard` gains `status` and `density="compact"`). A kind the app does not know, or a card with no title, falls back to its text line (`data-grammar-frame="card" | "text"`, `data-grammar-frame-kind`). `MessageBubble format="markdown"` and `MessageMarkdown` draw a message as safe Markdown (bold, italic, strikethrough, inline code, links, lists; no raw HTML, heading, image, table or fence, an unsafe link is its words). Laws `DNA-COMMON-FRAME-CARD-ONE-PRIMARY` and `DNA-COMMON-FRAME-CARD-MAX-ACTIONS`.
- Added (feedback 4): `ChatFrame empty`, what an empty thread shows, centred in the message area on both axes (`DNA-COMMON-CHAT-EMPTY-CENTRED`); a bare empty notice as the thread's only child is centred the same way.
- Fixed (feedback 5): a circle `Avatar` is a square box (aspect ratio 1, never squeezed by a flex row or stretched by a slot) clipped by a 50% radius at every size (`DNA-COMMON-AVATAR-ROUND`).
- Changed (feedback 6): `AvatarGroup layout="grid"` is no longer one big circle cut into tiles. It is the Zalo-style cluster: small round member avatars set close in a 2 by 2 inside an Avatar-sized square that is never clipped (two members on the diagonal, three as two over one, four or more as three and a count cell that reads the number of members of the whole group, not the hidden ones). `photo` replaces the cluster with the group's own picture. The grid ignores `max`; `avatarClusterCells` is the new shape rule (`avatarGroupTiles` stays for callers). `DNA-COMMON-AVATAR-CLUSTER`.
- Added (feedback 7): `Avatar channel` (and `channelLabel`): a small round channel badge in the avatar's bottom end corner, outside its clip, with the simple-icons logos of `CHANNEL_LOGOS` (Messenger, Instagram, Facebook, Zalo, WhatsApp, Telegram, TikTok, Gmail, LINE, Viber, WeChat, X, YouTube, Discord, Google Chat) and Grammar's own `email` envelope; brand colours are `--grammar-channel-*` tokens. `DNA-COMMON-AVATAR-CHANNEL-BADGE`.
- Manual steps: an app that read `data-grammar-figure-cue` or relied on the 4-tile `AvatarGroup layout="grid"` with a `+N` cell reads the headcount in the count cell now (4 members: three and "4").

## 0.59.4 - 2026-11-26

- Added (h-grammar-tech-logos): `MermaidDiagram` draws the built-in tech logos of `techIcons` (new export of `@starci/grammar/core/ext/graph`) for a node's `R@{ icon: "name" }` with no `icons` entry: `postgresql`, `mongodb`, `mysql`, `redis`, `express`, `nestjs`, `nodedotjs`, `docker`, `kubernetes`, `rabbitmq`, `apachekafka`, `nginx`, `graphql`, `typescript`, `javascript`, `go`, `python`, `react`, `nextdotjs`, `elasticsearch`, `minio` (simple-icons 16.38.1, CC0, vendored; `amazons3` is no longer shipped there), plus Grammar's own `database` and `service`. Each is monochrome (`currentColor`, aria-hidden, one line high). The `icons` prop still adds and overrides. A subgraph takes an icon too (`G@{ icon: "docker" }`), drawn before its name.

## 0.59.3 - 2026-11-25

- Fixed (h-grammar-mermaid-fit, the Next UI audit round 3): `MermaidDiagram` opens the WHOLE drawing at its first view, contain-fitted (zoom = min(1, room width / width, room height / height)) and centred in the room the 64px controls row leaves clear, so no node is cut on any side and the zoom buttons never stand over one (a tall lesson diagram cut "Loyalty" in half under the controls at 390px; a wide one ran off both edges at 1440 and 390). The canvas grows to hold the drawing at its width fit first, up to 45rem (35rem on a phone, was 30rem); a left-to-right graph too wide to read across is laid out top-down only when that opens it larger. A drawing that still needs a zoom under 0.85 opens whole and small, and the reader zooms in; the old readable floor no longer cuts the first view. `openZoom(frame, drawing)` and `canvasHeight(frameWidth, drawing, reserved)` lose their floor argument; `fittedZoom` and `betterTopDown` are new in `diagram/open.ts`.

## 0.59.2 - 2026-11-25

- Fixed (h-grammar-390): the action buttons of an `EmptyNotice` (the primary, the endArrow primary and the secondary) are `md`, the 40px control height, on every scope; they were `sm` (32px) in a region. The head of a `Section` wraps below 30rem (a 390px phone): the action slot drops under the title, at the start, instead of squeezing or cutting it.
- Fixed (h-grammar-next-010, the Next v0.0.10 UI audit): a scrolling tab strip reserves the width of each page control it shows, so the control never covers the edge tab's label at 390px, and the selected tab is revealed clear of it. `MermaidDiagram` opens a wide drawing fitted to its width whenever that stays readable (it no longer opens at 0.85 with its last node cut off), and a flowchart or state diagram too wide to read across its canvas is laid out top-down. The `ProportionBar` legend dot stands on the first line of a wrapping label. The `Disclosure` (and generic `Accordion`) trigger stands on the start edge of the content: the vendor indicator's `margin-inline-start: auto` no longer pushes the caret and the words to the far end.

## 0.59.1 - 2026-11-25

- Fixed (h-overlay-description-div): the `description` of `Dialog`, `AlertDialog` and `Drawer` is drawn in a `div` (was a `p`), so block content (a status line, a row) is valid HTML; it stays the overlay's `aria-describedby`.

## 0.59.0

- The StarCi Grammar: React components, compositions and packaged visual DNA.
- Chat has one look: `ChatFrame` is the one chat on a `Pane content="chat"`, a `Drawer` body or a page section; an incoming message is the flat surface, an outgoing one the accent, on every bubble, with no theme hook to repaint them.
- Manual steps: put a chat in `<Pane content="chat"><ChatFrame ...></Pane>` with the composer as the frame's `footer`; drop `tone` from `MessageBubble` and `MessageCard`, and `role` and `scrollRef` from `PaneSection scroll`; drop the `--starci-core-bubble-*` and `--starci-core-message-card` theme hooks.
