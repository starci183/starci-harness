# Command palette

Contract: [dialog](../../grammars/contract.md#dialog). Vendor: [Modal, ListBox, SearchField](../../vendor/heroui.md#modal).

## Job
Take one query from anywhere in the app and list what matches, grouped, to go to or to run.

Evidence (Rule 1). NIVO console shell canvas, repository `nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/`:
- `GRAMMAR-GAPS.md:9` (G1): global search as a command palette, grouped results, keyboard navigation, `Ctrl K`; the closest elements today (`SearchField`, `ComboBox`, `ListBox sections`) are each one part of it.
- `pages/01-shell-app.html:202` (the bar's search with the `Ctrl K` hint), `:224` (typing "giảm giá" opens a grouped result panel: Việc 2, Khách hàng 1, Second Brain 1, each row with a supporting line; the foot says up and down choose, Enter opens, Escape closes; at 390 the results fill the screen), `:226` (the page's ask: "cần Grammar: ô tìm chung dạng command palette có nhóm kết quả và phím Ctrl K (G1)").
- `briefs/01-shell-app.md:7`: the lane lists it as a needed Grammar element.

The need is not one product's: a CRM, an issue tracker and an editor each have a global search that groups its results and a keyboard that runs commands.

## Choose

Choice `command-palette.choose.search`: which search the person gets. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| global | one search reaches several kinds of things (work, people, documents) or runs commands, from any page | `CommandPalette`, opened by the bar's search control and `useCommandPaletteShortcut` | judgement |
| page | the search narrows the list on this page | `SearchField` above the list (a filter, [list-table](list-table.md)) | judgement |
| field | the search picks one value for a field | `ComboBox` ([select](select.md)) | judgement |

## Variants
- Results are `groups` (id, label, items) in the app's order; an item is `{ id, label, hint?, source?, shortcut?, href?, isDisabled? }`: a glyph, the label, one supporting line, and at the end the chord that runs it without the palette (`Kbd`).
  A result is a destination (`href`: the app root's router) or a command (`onAction(id)`); `onAction` runs for both and the palette closes.
- The palette does not filter. The app searches (`query`, `onQueryChange`) and passes the groups, so a server search and a local one are the same call.
- `isLoading` draws skeleton rows in the list's shape and marks the field pending; `error` takes the place of the results with its retry; `empty` stands where the results would when a search finds nothing (an `EmptyNotice`).
- `footer` is the keys hint in the app's language; it is not drawn on a coarse pointer, a touch screen having no keys (`DNA-COMMON-PALETTE-NO-KEYS-ON-TOUCH`, contextual). Every string (`label`, `closeLabel`, `placeholder`, `clearLabel`, the group labels) is the app's.
- Opened with `isOpen`/`onOpenChange` (or `defaultOpen`). `useCommandPaletteShortcut(onTrigger)` registers Ctrl K and Command K on the window once, in the shell, and the bar's search control (an `IconButton` or a `Button` with a `Kbd`) opens it by press; an app does not bind the shortcut itself.

## Keyboard
Focus lands in the field and stays there (virtual focus): ArrowDown and ArrowUp move the active result, Home and End jump, Enter chooses it, Escape closes, Tab leaves to the close button. The active result is named by `aria-activedescendant` and drawn as a selected row (the `--default` fill), never a focus ring. The page behind is inert and focus returns to the control that opened it.

## Size
`Dialog size="lg"` (48rem at most), standing at the top of the page (not centred) so the field never moves while results change; below 40rem it takes the full width at the top and is as tall as its results, capped by the screen (`DNA-COMMON-PALETTE-PHONE-NOT-FULL`). The field is the `md` control and the rows are the `ListBox` rows at `sm` (32 leading, 14 label, 12 hint).

## States
Closed, open with results, open with a query and no result (`empty`), loading, failed, a disabled result (`isDisabled`). A group with no results is not drawn.

## Owner split
- **Grammar owns:** the dialog, the field and list wiring, the virtual focus and keyboard, the group heads, the top placement and the full-width, content-height palette at 390, the shortcut hook.
- **Knowledge decides:** that one global search exists, what a group is, which results are commands.
- **App author decides:** the search itself, the groups and their order, the labels, the shortcut chords shown, the empty and error copy.

## Rules
FOCUS-3, STATE-3, STATE-8, A11Y-2, RESPONSIVE-1, and `DNA-COMMON-OVERLAY-IN-ROOT` (the palette portals into the grammar root, as a `Dialog`). Stories: `Overlays/Command palette (0.46.0)`.
