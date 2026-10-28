# Dialog, AlertDialog and Drawer

Contract: [Dialog and Drawer](../../grammars/contract.md#dialog). Vendor: [Modal, AlertDialog, Drawer](../../vendor/heroui.md#modal).

## Job
Hold a task that sits above the page. While open, the overlay is the view: the page behind is inert, and the
overlay has its own one commit (CTA-1).

## Choose

Choice `dialog-drawer.choose.role`: what holds the task above the page. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| confirm | an irreversible action needs its confirmation | `AlertDialog`: dismiss first and focused, solid danger confirm last, no commit (CTA-4) | `DNA-COMMON-ALERTDIALOG-DISMISS-FIRST` |
| none | a non-destructive action would only be acknowledged | nothing: no step exists only to acknowledge (UX-2) | judgement |
| inform | information that does not block | an inline region, a popover or `toast-alert.choose.owner`, not a modal | judgement |
| nav | compact navigation | the shell's navigation drawer from the leading edge (FE-APP-SHELL-4) | judgement |
| long | a longer secondary task that keeps page context (add documents, edit details, filters) | `Drawer` from the trailing edge | judgement |
| short | a short focused task that blocks the page (rename, invite) | `Dialog` | judgement |

## Variants
The backdrop and the size are the contract's; the app picks a size only by content measure. Nested fields and tabs
take their nested treatment from the overlay's surface.

## Size
Width by content: a form-sized dialog for one task; a drawer for the panel task. Fields inside stay one column.

## States
Focus enters, stays inside, returns to the opener on close; Escape and an explicit close path exist (FOCUS-3).
Batch options live in one closed disclosure card below the main task (LAYOUT-1). The footer is a decision group, also
when the body holds a form: the form carries an `id` and the footer's commit is a `Button` with `type="submit"` and
`form` naming it, so the decision stays in the footer and never moves into the body.

## Owner split
- **Grammar owns:** anatomy (heading, body, footer, close), backdrop, focus trap, portal into the grammar root, sizes.
- **Knowledge decides:** dialog vs alert dialog vs drawer vs inline; footer order; one commit; initial focus.
- **App author decides:** the trigger, title, body content, the actions' facts, open state when coordinated.

## Rules
CTA-1, CTA-4, CTA-5, LAYOUT-1, RESPONSIVE-1. Lint: `starci-fe/destructive-confirm-in-dialog`. Proof: FOCUS-3,
UX-2, UX-6.
