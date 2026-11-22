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
| nav | compact navigation | the shell's navigation drawer from the leading edge (FE-APP-SHELL-4); for a few daily places, a [bottom-nav](bottom-nav.md) whose "more" place opens a bottom `Drawer` | judgement |
| search | one search of the whole app that groups its results | [command-palette](command-palette.md): a `Dialog` standing at the top of the page, the screen at 390 | judgement |
| long | a longer secondary task that keeps page context (add documents, edit details, filters) | `Drawer` from the trailing edge | judgement |
| short | a short focused task that blocks the page (rename, invite) | `Dialog` | judgement |

## Variants
The backdrop and the size are the contract's; the app picks a size only by content measure. Nested fields and tabs
take their nested treatment from the overlay's surface.

## Popover width (0.45.1)
A `Popover` is 26rem wide, or the viewport less 2rem: a panel of rows (a leading mark, copy, an action, a time: a notification list) lays out at a readable measure, and a short
note stands in the same panel. The width is definite because a row list is a size container, which has no intrinsic width. There is no `width` or `size` prop: one look for every panel, so an app sets no width and
never wraps a popover's content in a fixed-width box. A panel that needs more than 26rem is a `Drawer` or a `Dialog`. Story `Overlays/Popover width (0.45.1)`.

## Popover size (0.46.2)
`Popover size` is `sm` (18rem: a short note, a small action menu), `md` (26rem, the default) or `lg` (36rem: a list of wide rows or a small form), each capped at the viewport less 2rem, so on a phone all three are the same full-width panel. The panel never takes its trigger's width, and an app sets no width of its own. Story `Overlays/Popover width (0.45.1)` (Sizes).

## Popover edge and the phone sheet (0.48.0)
The panel has a 1px `--border` and a soft shadow, so it reads as a layer over a white surface (`DNA-COMMON-POPOVER-EDGE`; Offset Pop keeps its ink outline). At 480px and narrower the popover is a sheet: fixed to the bottom edge at the full width, its top corners rounded, at most 85% of the screen tall, over a scrim that dims the page; a press on the scrim is outside and closes it, and the arrow is not drawn (`DNA-COMMON-POPOVER-PHONE-SHEET` at 320, 360 and 390). The app passes nothing: the width decides. Story `Overlays/Popover sheet and the palette on a phone (0.48.0)`.

## Scrolling
A body that outgrows its sheet scrolls with no scrollbar: the edge fades where content continues and wheel, touch and keyboard still scroll
(OVERFLOW-6; an app element with `overflow-y-auto` is refused by lint `no-raw-scroll`; use the Grammar scroller or `PaneSection scroll`). A `Drawer`
takes `bodyInset="none"` when its body must run edge to edge across the sheet (a chat well, a list that owns its rows); the default keeps the inset.

## Size
Width by content: a form-sized dialog for one task; a drawer for the panel task. Fields inside stay one column, 24 apart
(FIELD-3, [field](field.md)). The body is flat sections, an object card the only card in it: a list of rows is a `Section kind="list"` (BOUNDARY-7,
lint `starci-grammar/surface-in-surface`) and a table the flat `DataTable` of `list-table.choose.role:table`.

## States
Focus enters, stays inside, returns to the opener on close; Escape and an explicit close path exist (FOCUS-3). Every modal-level
overlay (`Dialog`, `AlertDialog`, `Drawer`, a `PaneGrid` pane's drawer) and the vendor's popovers share HeroUI's one stacking
level `--z-index-overlay`, so the overlay opened last is on top: a confirmation opened inside a drawer covers that drawer at
every width; the toaster sits above them on `--z-index-toast` (owner: `@starci/grammar src/common/components-overlays.css`).
Batch options live in one closed disclosure below the main task (LAYOUT-1). The footer is a decision group, also
when the body holds a form: the form carries an `id` and the footer's commit is a `Button` with `type="submit"` and
`form` naming it, so the decision stays in the footer and never moves into the body.

## Owner split
- **Grammar owns:** anatomy (heading, body, footer, close), backdrop, focus trap, portal into the grammar root, sizes.
- **Knowledge decides:** dialog vs alert dialog vs drawer vs inline; footer order; one commit; initial focus.
- **App author decides:** the trigger, title, body content, the actions' facts, open state when coordinated.

## Rules
CTA-1, CTA-4, CTA-5, LAYOUT-1, RESPONSIVE-1, FIELD-3, BOUNDARY-7. Lint:
`starci-grammar/surface-in-surface`. Proof: FOCUS-3,
UX-2, UX-6.
