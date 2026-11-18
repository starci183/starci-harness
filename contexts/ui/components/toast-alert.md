# Toast and Alert

Contract: [Toast and Alert](../../grammars/contract.md#alert). Vendor: [Alert](../../vendor/heroui.md#alert).

## Job
Report an outcome or a standing notice. Where it appears follows FEEDBACK: the smallest owner that can be
corrected or recovered.

## Choose

Choice `toast-alert.choose.owner`: who reports the outcome. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| field | a field's validation failure | the field's error, not an alert (FEEDBACK-1) | `DNA-COMMON-FIELD-ERROR-DESCRIBES` |
| progress | running work | the initiator's pending, never a toast (UX-4) | judgement |
| region | a region failed or is empty | that region's `empty-state.choose.cause`, or a soft negative `Alert` inside it | judgement |
| route | the whole route failed | one negative `Alert` where the first region would be, chrome kept (STATE-8) | judgement |
| durable | a result that matters later | a durable owner on the page, not only a toast (FEEDBACK-3) | judgement |
| toast | a transient confirmation of a settled result | a toast, announced once, pausing on hover and focus | `DNA-COMMON-TOASTER-LIVE` |
| page | something on the page needs the reader's attention | an `Alert` on the canvas, before the collection (HIERARCHY-3) | judgement |

An `Alert` has one look in every grammar: its tone's soft pair on the row (`x-soft` ground; glyph, title and description
`x-soft-foreground`), flat, with no shadow or border (`DNA-COMMON-ALERT-TONE-PAIR-*`). Its meaning picks the tone: informative
the NEUTRAL default pair (never the accent pair: pink/red reads as an error; an app may write its own `--informative-soft` pair), affirmative success, cautionary warning, negative danger, and
neutral, pending and unavailable the default pair. A `Toast` and the `AlertDialog` follow the same meaning (0.37.18): informative is neutral there too (the toast's mark `--muted`, the dialog's icon tile the default soft pair; `DNA-COMMON-TOAST-TONE-INFORMATIVE`, `DNA-COMMON-ALERTDIALOG-TONE-INFORMATIVE`); an app that writes `--informative` tokens keeps its own. A `Meter` is a measure, not a notice: a neutral or pending reading keeps the accent (ACCENT-4), and `tone="foreground"` fills it with `--foreground` on the empty track, the measure that spends no accent (ACCENT-6; `Progress` takes the same tone). The empty track of every measure (`Progress` and its steps, `Meter` and its segments, `ProgressCircle`, `ProportionBar`) is one visible neutral, the theme hook `--starci-core-track` (by default the foreground at 10% over the surface, a step lighter than the Switch off track), never `--default`, which a white theme sets to the surface. It takes no appearance choice; the deprecated `appearance` prop does nothing.

## Alert form slot (0.47.0)
An `Alert` that asks for a decision holds the fields of the draft in `form` (a `Section kind="list" layout="keyValue"` or a few fields), a named slot, since a composite takes no `children`. The form stands under the description on the text's edge, and the actions move to a row of their own under it, at the end: `secondaryAction` (`alternative`, "Reject") then `action` (the tone's intent, "Approve"). Not with an `action` of `kind: "row"` (a development error). Loading keeps the box with the form as geometry. Story `Overlays/Alert form slot (0.47.0)`.

## Variants
Tone reports a real outcome (ACCENT-5); informative is neutral and spends none (red budget: [composition.md](../composition.md) ACCENT-6). The action's variant per tone is the
contract's. A toast holds at most one action.

## Size
Width follows its region; no size prop.

## States
A toast persists long enough to read and never auto-dismisses one that carries an action; the queue and timing are
the grammar's.

## Owner split
- **Grammar owns:** alert anatomy and appearances, tone paint, the toast queue, timing, announcement.
- **Knowledge decides:** which owner reports which outcome, surface vs soft, toast vs durable owner.
- **App author decides:** the words, the tone from authority, the one action.

## Rules
FEEDBACK-1..3, ACCENT-5, STATE-8. Proof: TRUTH-3, UX-4, UX-6, TASTE-5.
