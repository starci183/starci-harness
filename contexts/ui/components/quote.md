# Quote

Contract: [Quote](../../grammars/contract.md#quote).

## Job
Show words taken from a source (a stored note, a chat line, a template) inside a pane, a card or a drawer, set apart from the
surface that hosts them without becoming a surface.

## Choose

Choice `quote.choose.words`: how words that come from elsewhere are shown. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| outcome | the text reports what happened to the reader's action (saved, failed, sent) | `Alert`, never `Quote` ([toast-alert](toast-alert.md)) | judgement |
| source | the text is the words of a source the reader can name and the host is a pane, a card or a drawer | `Quote` with `source` as one short word and `byline` for where and when | judgement |
| message | the text is one message of a conversation thread | `MessageBubble`, with the thread kept by the app | judgement |
| plain | the words are the page's own copy | `Text`; a ground would claim a source the words do not have | judgement |

Choice `quote.choose.host`: where a `Quote` stands. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| pane | the words sit in a `PaneSection` band | `Quote` directly in the band, on no card (a `Pane surface` is itself the face and holds no card, `pane-grid.choose.frame:cards`) | judgement |
| card | the words belong to the subject of a card | `Quote` in the card's content; it is not a surface, so it does not nest one | judgement |
| drawer | the words are part of a task beside the page | `Quote` in the drawer body | judgement |
| group | rows or a block (not words) need the same quiet ground inside a surface: an approver panel, a short summary | `Inset` with an optional `label`; never a card inside a card | judgement |
| contradiction | two sources disagree on one fact | a `Section` whose title is the question, the two `Quote`s side by side in a `Cluster` (each names its source), and the answers as a decision group below (`action-group.choose.kind:decision`) | judgement |

## Variants
None. `source` and `byline` are optional facts, not variants: a quote with neither is the words alone.

## Size
It takes no step. Its words use the body step, its source and byline the caption step ([../scale.md](../scale.md)).

## States
Loading draws the ground with two skeleton lines and no source or byline (`isLoading`, STATE-8). It has no action, no
focus target and no selected state.

## Owner split
- **Grammar owns:** the `<blockquote>` anatomy, the tinted ground, the nested inset (`--grammar-inset-nested`), the radius one
  step below the host surface, no shadow, no outline, no action, the skeleton.
- **Knowledge decides:** quote against alert, message or plain text, and the host.
- **App author decides:** the words, the source word and the byline text.

## Rules
STATE-8. The name says a role, never a product feature (ruling `grammar-names-are-generic`).
