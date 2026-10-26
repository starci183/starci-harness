# Toast and Alert

Contract: [Toast and Alert](../../grammars/contract.md#alert). Vendor: [Alert](../../vendor/heroui.md#alert).

## Job
Report an outcome or a standing notice. Where it appears follows FEEDBACK: the smallest owner that can be
corrected or recovered.

## Choose

| Need | Use |
| --- | --- |
| a field's validation failure | the field's error, not an alert (FEEDBACK-1) |
| a region failed or is empty | that region's [empty-state](empty-state.md) or a soft negative `Alert` inside it |
| the whole route failed | one negative `Alert` where the first region would be, chrome kept (STATE-8) |
| something needs the reader's attention on a page | `Alert` on the canvas, before the collection (HIERARCHY-3) |
| a notice that belongs to a row, step or band | `Alert` with the soft appearance |
| a transient confirmation of a settled result | a toast, announced once, pausing on hover and focus |
| a result that matters later | a durable owner on the page, not only a toast (FEEDBACK-3) |
| progress of running work | the initiator's pending, never a toast (UX-4) |

## Variants
Tone reports a real outcome (ACCENT-5); informative spends accent. Appearance: `surface` on the canvas, `soft`
inside a band. The action's variant per tone is the contract's. A toast holds at most one action.

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
