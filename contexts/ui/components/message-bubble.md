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
| agent for the reader | an agent speaks on the reader's behalf and the reader may approve it (an AI's reply) | `side="outgoing" tone="soft"`: the brand tint (`--accent-soft`) with its foreground (`--accent-soft-foreground`), at the end side; `tone` never changes an incoming bubble (owner ruling 2026-11-06: no new token) | judgement |

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

## Variants
None. `side` is whose message it is, not a style.

## Size
It takes no step; the words use the body step and the author line the caption step ([../scale.md](../scale.md)).

## States
`isHighlight` draws the focus ring round the bubble (a link jumped here). Loading draws the face with two skeleton lines
(`isLoading`, STATE-8); a whole loading thread is the thread's own bubbles with `isLoading`. Actions show on hover and focus inside the message.

## Owner split
- **Grammar owns:** the faces, the corner that points at the avatar, the inline colours on each face, the actions toolbar, the skeleton.
- **Knowledge decides:** which side a message takes.
- **App author decides:** the thread (order, grouping, day dividers, scroll), the words, the author and the time.

## Rules
STATE-8. Ruling `message-bubble-primary-and-surface`.
