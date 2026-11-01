# Chat: ChatBubble

Contract: [ChatBubble](../../grammars/contract.md#chatbubble).

## Job
Show one message of a conversation. Every chat is `ChatBubble` messages in a thread the app keeps; no screen draws its own bubble.

## Choose

Choice `chat.choose.side`: whose message it is. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| mine | the reader wrote it | `side="outgoing"`: the brand fill (`--accent`) with its foreground (`--accent-foreground`), at the end side | judgement |
| theirs | anyone else wrote it: a person, an agent, the system | `side="incoming"` (the default): the surface and its foreground, at the start side | judgement |

Choice `chat.choose.inline`: what a message may hold. Plain words, a link, a mention (`Text tone="accent"`), code and a muted line
all inherit the bubble's foreground, so they read on either face; a link keeps its underline. Anything that is not the message's own
words (an attachment, an approval card, a reaction row) goes in `footer`, outside the bubble face.

## Variants
None. `side` is whose message it is, not a style.

## Size
It takes no step; the words use the body step and the author line the caption step ([../scale.md](../scale.md)).

## States
`isHighlight` draws the focus ring round the bubble (a link jumped here). Loading draws the face with two skeleton lines
(`isSkeleton`, STATE-8). Actions show on hover and focus inside the message.

## Owner split
- **Grammar owns:** the faces, the corner that points at the avatar, the inline colours on each face, the actions toolbar, the skeleton.
- **Knowledge decides:** which side a message takes.
- **App author decides:** the thread (order, grouping, day dividers, scroll), the words, the author and the time.

## Rules
STATE-8. Ruling `chat-primary-and-surface`.
