# Message bubble: MessageBubble

Contract: [MessageBubble](../../grammars/contract.md#messagebubble).

## Job
Show one message of a conversation. Every conversation is `MessageBubble` messages in a thread the app keeps; no screen draws its own bubble.

## The chat surfaces

Every chat (team chat, an agent's chat, an inbox customer thread, the assistant) draws the same three faces (`DNA-COMMON-CHAT-SURFACES`,
`DNA-COMMON-CHAT-INCOMING-FLAT`, `DNA-COMMON-CHAT-OUTGOING-ACCENT`):

- **the thread** is the page tone `--background`, never white: the `ChatFrame` thread paints it and meets the header line above and the
  footer line below edge to edge;
- **a message of someone else** (`MessageBubble` incoming, every `MessageCard`) has ONE look on every host, in every measure and content kind
  (text, card): the `--surface` fill, `--foreground` words, the 1px edge line, no shadow; a message is never a card, and no surface (a thread, a drawer
  of pinned messages, a white pane) changes it;
- **the reader's own message** is `--accent` with `--accent-foreground`; inline links, mentions, code and muted lines inherit it. A
  `Badge` in it (a mention, a tag) is the inverse pair (`--accent-foreground` ground, `--accent` words) and a `Quote` in it (the message
  replied to) is the foreground at a 16% tint with its words inheriting, so both read on the solid fill.
- **every bubble carries its `avatar`**, both sides: an outgoing bubble draws it at the end side; grouped follow-ups keep the spacer by `groupPosition`.
- **a draft** (a reply not sent yet) is an outgoing bubble whose `meta` or `status` says so ("Draft, not sent yet"); no prop marks it.
- **the message an answer replies to** is `ReplyStrip` as the first line of the answer's body: ONE
  compact line on the secondary surface, a 3px bar on its start edge in the replied author's tone (an agent's colour from the app's palette by `tone={{ soft, ink }}`, its ink on the bar; a person's muted ink),
  the reply glyph at 1em, the author in the medium weight, then the words muted and ellipsized; no "Reply to X:" label, no quotation marks, no box in a
  box. With `onPress` it is a button that scrolls the thread to the original and rings it (`isHighlight`). The thread draws NO strip when the answer
  follows the message it replies to with nothing between them: the reader sees that message right above. Story `Navigation & Data/Chat parts` `ReplyStrips`.
- **a question with answers** is ONE `ChoiceCard` as the body of `MessageBubble content="card"`: the short question
  on top (it never lists the answers again nor asks for a number), the answers as cells separated by hairlines, a long one on its own row and two short
  ones to a row, each naming the thing with a muted hint, and `other` as the last cell, which focuses the composer. A chosen answer fills its cell (accent
  soft, check) and closes the card, and the app posts the choice as the reader's own message. A destructive answer is the danger ink only (a cell is not
  a Button, so the danger Button rule does not apply to it) and asks once more. Never a row of Buttons under a text bubble for a question.
  Story `Navigation & Data/Chat parts` `ChoiceCards`.

Theme tokens only: the dark theme resolves from the same tokens. An app never restyles a face: no theme hook repaints a bubble, and no `className` or `style` on
`MessageBubble`/`MessageCard`, no class string reaching `starci-core-message-*`.
Story `Navigation & Data/Chat surfaces`.

## The chat frame

`ChatFrame` is the ONE chat on any host (`DNA-COMMON-CHAT-FRAME`): the header zone (who the reader talks to), one 1px full-width line, the
thread, one 1px full-width line, the footer zone. All of it is `--background` whatever surface the host stands on; the composer field keeps
its white field ground. Nothing else in the frame draws a divider: exactly two lines, and with no `footer` one. The rest of the page keeps
its own rule (a room list and the page header band stay white).

- **Header**: a `PaneHeader` (`mark` an Avatar, `title` the name, `status`, `description` the context line); for a customer chat the owner row
  stands beneath it in the same zone, with no inner divider.
- **Thread**: `MessageBubble`s and day `Divider`s, oldest first. It is the only scroller (`DNA-COMMON-CHAT-FRAME-SCROLL`): it opens at the newest
  message and follows new ones while the reader is at the foot; `scrollRef` is the element that scrolls, for jump-to-message. `label` names it.
- **Footer**: the composer, or the decision actions of a draft (approve and send, edit, ask the agent to edit, do not send).

| Host | Write |
| --- | --- |
| a grid | `Pane content="chat"` holding the one `ChatFrame`; the pane takes no `footer`, `head`, `surface` or `inset` |
| a drawer | `Drawer bodyInset="none"` holding the `ChatFrame`, no drawer `footer`: the sheet's title row and the frame header read as ONE header zone (no line, no gap between them) and only the thread scrolls |
| a page section | the `ChatFrame` in a box whose height the page gives it |

Story `Navigation & Data/Chat frame`: `InPane`, `InDrawer`, `Inline`, `WithoutFooter`, `LoadingAndError`.

## Choose

Choice `message-bubble.choose.side`: whose message it is. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| mine | the reader wrote it, or a draft the reader may send (marked by its `meta`) | `side="outgoing"`: the brand fill (`--accent`) with its foreground (`--accent-foreground`), at the end side | `DNA-COMMON-CHAT-OUTGOING-ACCENT` |
| theirs | anyone else wrote it: a person, an agent, the system | `side="incoming"` (the default): the flat `--surface` with `--foreground` words (the 1px edge line, no shadow), at the start side | `DNA-COMMON-CHAT-INCOMING-FLAT` |

Choice `message-bubble.choose.sender`: the sender line above the body of the first message of a run. `author` names the sender; for an AI agent add `isAgent`: the bubble draws the AI Chip right after the name, which [identity-mark](identity-mark.md) "The AI Chip" owns.

Choice `message-bubble.choose.inline`: what a message may hold. Plain words, a link, a mention (`Text isStrong`), code and a muted line
all inherit the bubble's foreground, so they read on either face; a link keeps its underline. Anything that is not the message's own
words (an attachment, an approval card, a reaction row) goes in `footer`, outside the bubble face.

Choice `message-bubble.choose.suggestions`: how a message offers replies the reader can send in one press. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| in a card | a `MessageCard` (an agent's stop card, a question) offers replies to its own question | ONE flat list in the card `body`: `Section kind="list" layout="suggestions" ariaLabel empty={null} items` with one row per reply, `{ id, title: text, onPress: send(text) }` and nothing else: the plain text (14, regular, wrapping, never truncated), the whole row the one button, a trailing chevron that stays at the end of the row at every width (390 included), vertically centred, the text wrapping beside it; flat in the card (BOUNDARY-7), never a nested card, a grey box or a row of pills | `DNA-COMMON-CARD-SUGGESTIONS`; stories `Chat surfaces` `ChatPane`, `Flow graph selected (0.37.35)` `SuggestionsChevron390` |
| by the composer | the thread offers things to ask next, above the composer | a `Cluster gap="inline"` of neutral `Button size="sm"` pills ([button](button.md) `button.choose.role:suggest`) |

Choice `message-status.choose.fact`: which authority-owned message fact the footer reports.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| receipt | an actual send, delivery or read acknowledgement is known | `MessageStatus kind="receipt"`, state `sent`, `delivered` or `seen`; typed readers belong only to seen | type: receipt states and reader placement; visible localized label |
| transport | the transport reports its current send outcome | `MessageStatus kind="transport"`, state `queued`, `sent`, `failed` or `unknown` | type: transport states; visible localized label |

Both forms occupy the existing footer slot. The Bubble gains no receipt props, and ordinary Text does not pick a
paint to imitate the semantic owner. Read people retain their names and localized overflow copy.

Choice `message-bubble.choose.content`: what the bubble body is. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| text | the message is words | `MessageBubble content="text"` (the default) | judgement |
| card | an agent's rich message: a title with a chip, then a body or a key/value list, then actions | `MessageCard` (renders `MessageBubble content="card"`; a card that waits says so in its `chip` and words, never in an edge): title and `chip`, then `body` or a compact `details` list, then the actions row (the primary first, an `open` action with `endArrow` last), then a meta line (12 muted); capped at the bubble measure (`standard`, or `wide` 70%) with the avatar at the start, never full width; its content column fills the card, so a flat list (`Section kind="list"`) or a composer in `body` spans the card's inner width while the head, actions and meta start at the reading edge | story `Navigation & Data/Chat parts/MessageCards`, `Navigation & Data/Message card fill (0.37.30)`; `check:type` |

Chat surroundings: an `EmptyNotice` inside a thread (the `ChatFrame` thread, or a stack holding
`MessageBubble`s) draws no card surface (no fill, border, radius or shadow; detected by context, no prop), and the header of a
chat frame ends in one full-width separator. Stories `EmptyNoticeInThread`, `ChatPaneHeadLine`.

Grouping and reactions: `groupPosition` (`single` default, `first`, `middle`, `last`; the app computes it from the sender
and the time gap) shapes the bubble like Messenger: a lone bubble is rounded 18, only the corners where two bubbles of one sender touch are 4
(first: bottom on the sender's side; middle: both; last: top), logical corners so RTL mirrors; the avatar sits beside the last bubble and the
earlier ones keep a spacer; the author line shows on single and first. An incoming bubble and a `MessageCard` are the flat surface on the
thread; an outgoing bubble is the brand fill. Reactions are presentation only: `reactions` (`{ emoji, count, mine }`), `onReact`,
`onReply`, `onShare`. The hover or long-press toolbar is a labelled `toolbar` with arrow keys (six emoji, reply, share), and with the floating
`actions` it is ONE tray: from 48rem the toolbar floats above the bubble and the actions beside it; below 48rem hover opens nothing and a
long press on the bubble (or keyboard focus inside the message) opens the tray in the thread's flow above the body, one bordered piece whose
buttons wrap inside the row, so it never covers the bubble above nor runs past the row's edge (the play of story
`Chat surfaces / Reaction tray` proves it at 1440 and 390; a static law cannot open the tray); a tap on one of its buttons closes it. The pill on the bottom
corner shows up to three emoji and the total and adds the viewer's top reaction on press; each tap bursts floating emoji (none under reduced
motion). The composer band (a `PaneSection as="footer"` or `rule="start"`) keeps the row gap between its divider and its rows. Stories
`BubbleGrouping`, `Reactions`.

## The hover rail: MessageActions

Modelled on Messenger. The owner asked for "hover ra icon… như facebook, 3 cái icon bên phải/trái từng đoạn chat", then corrected it to "icon thôi size 16 đi, không có border", and then to "kiểu nút ghost size sm á … nút ghost của heroui á trò". The owner's words win:

- **Three actions** beside a bubble: react (a smile), reply (a back arrow), more (three dots). Each is **HeroUI's own `Button variant="ghost" size="sm" isIconOnly`, used as shipped, with a 16px icon**. No custom colour, radius or hover style: HeroUI's ghost look is the look. No border and no fill until the ghost hover fill; the open trigger keeps that fill. The gap between them is about 10px (one inline gap on Grammar's scale, 8), centred on the bubble.
- **Side:** on the right of another person's or an agent's bubble (`side="incoming"`), on the left of the viewer's own (`side="outgoing"`). `MessageBubble messageActions` gives the rail its side.
- **Shown only** on hover (desktop), on a long press (touch) or when the message has keyboard focus inside. Opacity fades in 120ms, with no motion under reduced motion.
- **The reaction picker** is a floating popover pill: the popover's elevation, no border, the surface ground, fully rounded. It opens ABOVE the react button, anchored by its end to that button, and extends over the bubble (toward the start for others' messages, toward the end for the viewer's own). Emojis are about 28px in 40px cells (❤️ 😆 😮 😢 😡 👍) with a slight scale on hover, then a "+" that calls the app's `onMore` to open the full picker. An outside press or Esc closes it.
- **The chosen reaction** shows as a small chip overlapping the bubble's bottom corner: `MessageBubble reactions`.
- **More** opens a `DropdownMenu` of the app's `menu` items (copy, pin; recall on the viewer's own; create a task from this message on an agent's). Reply puts the composer in reply mode; that is the app's.
- **Names** are the app's i18n (`labels`): "Bày tỏ cảm xúc", "Trả lời", "Thêm".
- **Not on engine cards** (approval, stop): they keep their own buttons.

Story `Navigation & Data/Avatar initials and message actions`, shot at 390 and 1440 in light and dark.

## Variants
None. `side` is whose message it is, not a style.

## Size
It takes no step; the words use the body step (14) and the author line and meta the small-name step (12) ([../scale.md](../scale.md), FONT-7).

## States
`isHighlight` draws the focus ring round the bubble (a link jumped here); a render highlights one thing (lint `one-highlight-per-render`, R359). Loading draws the face with two skeleton lines
(`isLoading`, STATE-8): incoming the flat surface, outgoing the brand's SOFT pair (`--accent-soft`, its lines in `--accent-soft-foreground` at a tint), never the solid fill a real message wears (`DNA-COMMON-CHAT-SKELETON-SOFT`, story `Chat surfaces / Loading thread`); a whole loading thread is the thread's own bubbles with `isLoading`. While a party writes its answer, its bubble (its avatar, name and meta line) holds `TypingDots` as its body, and the answer replaces that body in place. Actions show on hover and focus as the grammar's floating toolbar beside the bubble: icon commands named by tooltips that never overlap its text.

## Owner split
- **Grammar owns:** the chat frame and its thread ground, the faces (flat surface, accent), the corner that points at the avatar, the inline colours on each face, the actions toolbar, the skeleton, the card's suggestion list.
- **Knowledge decides:** which side a message takes.
- **App author decides:** the thread (order, grouping, day dividers, scroll), the words, the author and the time.

## Rules
STATE-8.
