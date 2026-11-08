# Message bubble: MessageBubble

Contract: [MessageBubble](../../grammars/contract.md#messagebubble).

## Job
Show one message of a conversation. Every conversation is `MessageBubble` messages in a thread the app keeps; no screen draws its own bubble.

## Choose

Choice `message-bubble.choose.side`: whose message it is. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| mine | the reader wrote it | `side="outgoing"`: the brand fill (`--accent`) with its foreground (`--accent-foreground`), at the end side | judgement |
| theirs | anyone else wrote it: a person, an agent, the system | `side="incoming"` (the default): the surface and its foreground, at the start side | judgement |
| agent for the reader | an agent speaks on the reader's behalf and the reader may approve it (an AI's reply) | `side="outgoing" tone="soft"`: the brand tint (`--accent-soft`) with its foreground (`--accent-soft-foreground`), at the end side; `tone` never changes an incoming bubble, and no new token exists for it | judgement |

Choice `message-bubble.choose.inline`: what a message may hold. Plain words, a link, a mention (`Text isStrong`), code and a muted line
all inherit the bubble's foreground, so they read on either face; a link keeps its underline. Anything that is not the message's own
words (an attachment, an approval card, a reaction row) goes in `footer`, outside the bubble face.

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
| card | an agent's rich message: a title with a chip, then a body or a key/value list, then actions | `MessageCard` (renders `MessageBubble content="card"`): title and `chip`, then `body` or a compact `details` list, then the actions row (the primary first, an `open` action with `endArrow` last), then a meta line (12 muted); capped at the bubble measure (`standard`, or `wide` 70%) with the avatar at the start, never full width | story `Navigation & Data/Chat parts/MessageCards`; `check:type` |

Chat surroundings (Grammar 0.31.0): an `EmptyNotice` inside a thread (a `PaneSection scroll role="log"` band, or a stack holding
`MessageBubble`s) draws no card surface (no fill, border, radius or shadow; detected by context, no prop), and the head band of a
chat or list pane (a `PaneSection as="header"` above a `scroll` band) ends in one full-width separator, its block-end padding
equal to its block-start inset. Stories `EmptyNoticeInThread`, `ChatPaneHeadLine`.

Grouping and reactions (Grammar 0.32.0). `groupPosition` (`single` default, `first`, `middle`, `last`; the app computes it from the sender
and the time gap) shapes the bubble like Messenger: a lone bubble is rounded 18, only the corners where two bubbles of one sender touch are 4
(first: bottom on the sender's side; middle: both; last: top), logical corners so RTL mirrors; the avatar sits beside the last bubble and the
earlier ones keep a spacer; the author line shows on single and first. An incoming bubble and a `MessageCard` are lifted (1px `separator` border
plus the card shadow); an outgoing bubble keeps the brand fill. Reactions are presentation only: `reactions` (`{ emoji, count, mine }`), `onReact`,
`onReply`, `onShare`. The hover or long-press toolbar is a labelled `toolbar` with arrow keys (six emoji, reply, share); the pill on the bottom
corner shows up to three emoji and the total and adds the viewer's top reaction on press; each tap bursts floating emoji (none under reduced
motion). The composer band (a `PaneSection as="footer"` or `rule="start"`) keeps the row gap between its divider and its rows. Stories
`BubbleGrouping`, `Reactions`.

## Variants
None. `side` is whose message it is, not a style.

## Size
It takes no step; the words use the body step (14) and the author line and meta the small-name step (12) ([../scale.md](../scale.md), FONT-7).

## States
`isHighlight` draws the focus ring round the bubble (a link jumped here). Loading draws the face with two skeleton lines
(`isLoading`, STATE-8); a whole loading thread is the thread's own bubbles with `isLoading`. Actions show on hover and focus as the grammar's floating toolbar beside the bubble: icon commands named by tooltips that never overlap its text.

## Owner split
- **Grammar owns:** the faces, the corner that points at the avatar, the inline colours on each face, the actions toolbar, the skeleton.
- **Knowledge decides:** which side a message takes.
- **App author decides:** the thread (order, grouping, day dividers, scroll), the words, the author and the time.

## Rules
STATE-8.
