# Dialog, AlertDialog and Drawer

Contract: [Dialog and Drawer](../../grammars/contract.md#dialog). Vendor: [Modal, AlertDialog, Drawer](../../vendor/heroui.md#modal).

## Job
Hold a task that sits above the page. While open, the overlay is the view: the page behind is inert, and the
overlay has its own one commit (CTA-1).

## Choose

| Need | Use |
| --- | --- |
| confirm an irreversible action | `AlertDialog`: dismiss first and focused, solid danger confirm last, no commit (CTA-4) |
| a short focused task that blocks the page (rename, invite) | `Dialog` |
| a longer secondary task that keeps page context (add documents, edit details, filters) | `Drawer` from the trailing edge |
| compact navigation | the shell's navigation drawer from the leading edge (FE-APP-SHELL-4) |
| information that does not block | inline region, popover or [toast](toast-alert.md), not a modal |
| a confirmation of a non-destructive action | nothing: no step exists only to acknowledge (UX-2) |

## Variants
The backdrop and the size are the contract's; the app picks a size only by content measure. Nested fields and tabs
take their nested treatment from the overlay's surface.

## Size
Width by content: a form-sized dialog for one task; a drawer for the panel task. Fields inside stay one column.

## States
Focus enters, stays inside, returns to the opener on close; Escape and an explicit close path exist (FOCUS-3).
Batch options live in one closed disclosure card below the main task (LAYOUT-1). The footer is a decision group.

## Owner split
- **Grammar owns:** anatomy (heading, body, footer, close), backdrop, focus trap, portal into the grammar root, sizes.
- **Knowledge decides:** dialog vs alert dialog vs drawer vs inline; footer order; one commit; initial focus.
- **App author decides:** the trigger, title, body content, the actions' facts, open state when coordinated.

## Rules
CTA-1, CTA-4, CTA-5, LAYOUT-1, RESPONSIVE-1. Lint: `starci-fe/destructive-confirm-in-dialog`. Proof: FOCUS-3,
UX-2, UX-6.
