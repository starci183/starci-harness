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
`x-soft-foreground`, in every tone), flat, with no shadow or border, like a big chip (`DNA-COMMON-ALERT-TONE-PAIR-*`). Radius 12, a 12 by 16
inset, a 12 gap; the mark is the original Heroicons 24 outline glyph at its native size and stroke, in `--<tone>-soft-foreground` on the `--<tone>-soft` box, with no tile and no plate (owner 2026-11-22: "alert nói rõ là icon 24 soft-foreground trên nền soft thôi mà?"; pending's spinner is 24 too), pulled up 2px onto the 20px title line; the title is 14/20 at 500 and the description 14/20 at 400 (the label.item role). Its meaning picks the tone: informative
the built-in info tone (blue, 0.55.0; never the accent pair: pink/red reads as an error; an app may write its own `--informative-soft` pair), affirmative success, cautionary warning, negative danger, and
neutral, pending and unavailable the default pair. A `Toast` and the `AlertDialog` follow the same meaning (0.37.18): informative is neutral there too (the toast's mark `--muted`, the dialog's icon tile the default soft pair; `DNA-COMMON-TOAST-TONE-INFORMATIVE`, `DNA-COMMON-ALERTDIALOG-TONE-INFORMATIVE`); an app that writes `--informative` tokens keeps its own. A `Meter` is a measure, not a notice: a neutral or pending reading keeps the accent (ACCENT-4), and `tone="foreground"` fills it with `--foreground` on the empty track, the measure that spends no accent (ACCENT-6; `Progress` takes the same tone). The empty track of every measure (`Progress` and its steps, `Meter` and its segments, `ProgressCircle`, `ProportionBar`) is one visible neutral, the theme hook `--starci-core-track` (by default the foreground at 10% over the surface, a step lighter than the Switch off track), never `--default`, which a white theme sets to the surface. It takes no appearance choice (`appearance` is deleted in 0.55.0; the v0550 codemod drops it). Its action Button is SOLID in the banner's tone (owner: "button phải là màu tương ứng, ko phải border"; Button `tone`): warning-filled on a cautionary banner, danger on negative, info on informative, success on affirmative, accent on accent; a neutral, pending or unavailable banner keeps the intent's look (`DNA-COMMON-ALERT-ACTION-SOLID`).

## Alert form slot (0.46.2)
An `Alert` that asks for a decision holds the fields of the draft in `form` (a `Section kind="list" layout="keyValue"` or a few fields), a named slot, since a composite takes no `children`. The form stands under the description on the text's edge, and the actions move to a row of their own under it, at the end: `secondaryAction` (`alternative`, "Reject") then `action` (the tone's intent, "Approve"). Not with an `action` of `kind: "row"` (a development error). Loading keeps the box with the form as geometry. Story `Overlays/Alert form slot (0.46.2)`.

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

## The retry of a negative banner (0.48.0)
The action's look per tone is ONE table, `ALERT_ACTION_LOOK` (`src/core/composite/Alert/index.tsx`, 0.55.0), so a tone flips in one line (the owner
may switch warning to `border`):

| tone | action look |
| --- | --- |
| informative | `primary`, tone `info` (solid in the banner's colour) |
| accent | `primary`, tone `accent` |
| affirmative | `primary`, tone `success` |
| cautionary | `primary`, tone `warning` |
| negative | `border` (the retry, `RETRY_VARIANT`) |
| neutral, pending, unavailable, an app's own tone | `border` |
| any tone, `action.isDestructive` | `danger` |

The `secondaryAction` and the dismiss are always `border`. Only a `primary` action draws its `icon`.

A negative `Alert`'s `action` is the `border` (outlined) button, the one look of "Thử lại" wherever a read failed, as in an `ErrorView`; it is `danger` only when the action itself destroys (`action.isDestructive`). A destructive decision belongs to an `AlertDialog`, never to a banner's action. Law `DNA-COMMON-RETRY-ONE-LOOK`.

## ToastStack and stackToast (0.49.1)
`ToastStack` is the region of HeroUI's own Toast (white card, status icon, title, description, one action, close) and `stackToast` is its callable: `show({ title, description?, meta?, tone?, action?, timeout? })` answers an id, `update(id, options)` turns that toast into another, `dismiss(id)` closes it. One act is one toast: a check that starts pending is updated in place to its result, never followed by a second toast. Mount exactly one `ToastStack` inside the root (default `bottom end`); it sits beside `Toaster` and leaves it unchanged. Generic: the words, the tone and the one action are the app's.

| Tone | Variant | Stays |
| --- | --- | --- |
| affirmative, informative, cautionary, neutral | success, accent, warning, default | 5 s |
| negative | danger | until dismissed |
| pending | a spinner | until updated or dismissed |
| any with an action | as its tone | until dismissed |

The title is the foreground at 14 / 500 and the description the muted colour at 12 whatever the variant (`DNA-COMMON-TOASTSTACK-TYPE`); the status icon alone keeps the variant's colour. A pending toast is the one act's own progress where the act's outcome is itself a toast; running work that has a place on the page keeps the initiator's pending (UX-4). Laws `DNA-COMMON-ONE-TOASTSTACK`, `DNA-COMMON-TOASTSTACK-IN-ROOT`. Story `Overlays/ToastStack`.
