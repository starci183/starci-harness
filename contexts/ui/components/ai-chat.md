# AI chat: AiChatThread (`@starci/grammar/core/ext/chat`)

Contract: [AI chat](../../grammars/contract.md#ai-chat). Library: assistant-ui (`@assistant-ui/react`, MIT, its headless primitives and its
external store runtime only), pinned in `contexts/stack/pins.yaml`. Parts: [message bubble](message-bubble.md), [text field](text-field.md)
(the chat composer), [card](card.md), the core `Markdown`.

## Job
A whole chat with an assistant, drawn the way Claude and Codex draw one: the reader asks, the assistant answers in streaming markdown, calls
tools, and proposes a final result the reader approves or keeps revising. Apps take EVERY assistant chat page with it: never
`@assistant-ui/react` imported directly (`DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY`, lint `starci-grammar/no-graph-or-animation-library`), never
a hand-built thread of bubbles and a composer for an assistant. A chat between people stays `MessageBubble` in a `Pane content="chat"`.

## Where it lives
An ext of the core grammar: `import { AiChatThread } from "@starci/grammar/core/ext/chat"` and `@starci/grammar/core/ext/chat.css` after the
Grammar's styles. It imports core's components and tokens; core never imports it. `@assistant-ui/react` is an OPTIONAL peer dependency of
`@starci/grammar` (`peerDependenciesMeta.optional`): an app that shows the chat installs it at the pinned version. No Vercel AI SDK, no
assistant-ui styled package, no shadcn styles.

## API
- The app owns the conversation (assistant-ui's external store): `messages` (`{ id, role: "user" | "assistant", parts, status?, createdAt? }`,
  a part is `{ type: "text", text }` in markdown or `{ type: "tool-call", toolCallId, toolName, title, args, result?, status }`) and `isRunning`.
  A streamed answer is the app growing the last text part; each render draws the longer text.
- `onSend(text)` (Enter or the send action; the app appends the reader's turn and starts the run), `onStop` (the send action turns into stop
  while a run goes; without `onStop` it stays a disabled send), `onRetry` (on the last assistant turn while nothing runs). Each goes through the
  runtime (append, cancel, reload) to the callback.
- `preview` (`{ title, rows: [{ label, value }], approveLabel, reviseLabel, approving?, approved? }`) after the last message, with `onApprove`
  and `onRevise` (the composer takes the focus after it).
- `labels`: EVERY word, in the app's language (`placeholder`, `send`, `stop`, `retry`, `copy`, `thinking`, `toolRunning`, `toolDone`,
  `toolError`, `empty?`, `latest?` with an English default). `header` is a slot above the thread; `disabled` makes the composer read-only.
- Three optional slots: `assistantAvatar` (an Avatar item, `AiChatAssistantAvatar`: the provider's initials, a `mark`, or `kind: "logo"` with
  its `src`), `afterMessages` (a node after the last message and the preview, inside the thread: a Divider such as "you approved version 2", an
  inline Alert for an error) and `composerHint` (a string, the caption at the start of the composer's foot row).

## Look
- **The frame** is the chat frame ([message bubble](message-bubble.md) "The chat frame"): head, thread and composer foot on `--background`,
  hairlines between them, only the thread scrolls. Turns and the composer stand in one centred reading column with the page gutter, so 390
  has no horizontal scroll.
- **The reader's turn** is the neutral soft `MessageBubble` (`tone="neutral"`, no accent fill) at the end side, its text as typed. **An assistant turn** is no bubble: plain markdown
  across the column (the core `Markdown`, fences in the code palette with their Copy), then its actions, the `sm` border icon buttons copy and,
  on the last turn, retry. With `assistantAvatar` each assistant turn starts with its `sm` (24px) decorative Avatar, the answer beside it at the
  row gap.
- **Thinking**: while a run has nothing to show yet, the running `InlineStatus` with `labels.thinking`.
- **A tool call** is one folded `Disclosure` row in a 1px `--border` edge: the app's title, then its status as an `InlineStatus` (glyph and
  words); open, the arguments as stacked facts and the result (a string as text, anything else as JSON in the code palette).
- **The proposed result** is a `SurfaceCard` labelled by its title with the warning edge while it waits on the reader (success once approved),
  its rows a stacked `DescriptionList` (a long value keeps its line breaks), and its actions band: approve is the region's ONE primary, revise
  the border look; `approving` keeps approve's name and blocks a second press; `approved` puts the approve words marked done in place of the band.
- **The viewport** follows the newest message while the reader is at the foot and stops when the reader scrolls up; a floating `sm` arrow
  (named `labels.latest`) brings the reader back.
- **The composer** is one bordered box (a 1px --border edge, the focus ring on the box): the core `Textarea onSubmitShortcut` on top with its own frame
  taken off (one line growing to six, Enter sends, Shift+Enter breaks the line), and a foot row inside the same box, `composerHint` as a caption at the
  start and the round `sm` primary send at the end, which becomes stop (`labels.stop`) while a run goes.

Story `Navigation & Data/AI chat`: empty, a conversation with a code block and a tool call, streaming, the preview, approving, disabled, the three slots and an inline error.
