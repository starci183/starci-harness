# Bottom nav

Contract: [shell](../../grammars/contract.md#shell). Vendor: [Drawer, ListBox](../../vendor/heroui.md#modal). Added in 0.46.0 (owner approved 2026-11-18).

## Job
Put the few places a person uses every day under the thumb at the compact width, with the rest one press away in a bottom sheet.

Evidence (Rule 1: the need is a drawn page, not a guess). NIVO console shell canvas, repository `nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/`:
- `pages/01-shell-app.html:248-251`: "Thanh dưới 390", five places (Office with a count, Overview, Work flow, Duties with a count, More) drawn as the compact navigation; `:343` the sheet of the rest ("Thêm"); `:385` the offline strip over the same bar.
- `pages/01-shell-app.html:214` and `briefs/01-shell-app.md:7`: the lane asks for `WorkspaceShell` `compactNavigation` and records the conflict with FE-APP-SHELL-4 on purpose ("vẽ theo canvas chủ đã duyệt").
- `GRAMMAR-GAPS.md:29`: the sheet itself is `Drawer placement="bottom"`; the bar had no component.

## Choose

Choice `bottom-nav.choose.compact`: how the compact width reaches the app's places. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| few | five places or fewer cover what a person does daily | `WorkspaceShell` `compactNavigation` holding a `BottomNav` of those places | `DNA-COMMON-NO-BOTTOM-TABS` |
| more | the app has more places than a thumb reaches | the same `BottomNav` with `more`: the first four places in the bar, the rest in the sheet | `DNA-COMMON-NO-BOTTOM-TABS` |
| drawer | every place is equal and none is daily | no bar: `WorkspaceShell` `navigationDrawer` with a `Sidebar presentation="drawer"` (FE-APP-SHELL-4) | judgement |

A bar with one place is not a navigation: two to five places, the "more" place included (a dev-time error otherwise). A destination in the bar is a place the person
returns to, never a command (a command lives in the page's actions).

## Variants
- A place is a link (`href`: the app root's router opens it, a modifier press opens a tab) or a command (no `href`: `onAction(id)` is its only effect). `onAction` also runs after a link press.
- `selectedKey` marks the current place: `aria-current="page"` on it, the default fill behind it, a semibold name. A key that is in `more.items` or in a group of `more.groups` marks the "more" place (`data-grammar-current`) and the row in the sheet.
- A count (`badge`, `badgeLabel`, `badgeMax`, `badgeTone`) is the sidebar's, pinned to the glyph's end corner: see [sidebar](sidebar.md#the-tone-of-a-count). `badgeLabel` is the words ("4 waiting for you"), the place's accessible name becomes "Office, 4 waiting for you".
- The sheet is a bottom `Drawer` titled by `more.label` holding `Sidebar presentation="drawer"` of `more.items` (flat) or `more.groups` (the `Sidebar` group: `id`, `label`, `items`, the `label` drawn as the heading of its rows; give one of the two, a console with named areas gives groups): one look for a place in the sheet, the drawer and the rail; a place there takes a count, a trailing mark, `href` and `isDisabled` as a sidebar item does. Choosing a place closes the sheet and returns focus to the "more" place.

## Size
The place is the bar-control height (the `md` 40, glyph 20 over a one-line 12 name), its hit area stretched to the bar's 48 by a pseudo element so the box never grows (`DNA-COMMON-TARGET-COARSE`
floor). The places share the width equally. The bar keeps `env(safe-area-inset-bottom)`: the page sets `viewport-fit=cover` for it to be non-zero. The bar draws below 48rem only; above it the slot is `display: none` and the navigation is the sidebar.

## States
Hover and focus-visible (the vendor ring), current, pressed. A disabled place is not drawn in the bar (a sheet row may be disabled). The "more" place is a button (`aria-haspopup`, `aria-expanded` from the Drawer trigger).

## Owner split
- **Grammar owns:** the list of places, the equal shares, the safe area, the current mark, the count's tint, the sheet and the focus return.
- **Knowledge decides:** which places are daily (two to five), what goes in the sheet, whether the app opts in at all.
- **App author decides:** `items`, `more`, `selectedKey`, the labels (including the "more" label and the close label) and the count words.

## Rules
FE-APP-SHELL-4 (see below), A11Y-2, BOUNDARY-1, RESPONSIVE-1.

The landmark is the shell's: `compactNavigation` renders `<nav aria-label={compactNavigationLabel}>` around the slot, so `BottomNav` draws a list and no second `<nav>`. It stands only in that slot (`DNA-COMMON-NO-BOTTOM-TABS`).

**Owner decision (2026-11-18).** The bar is allowed only as the `compactNavigation` of a `WorkspaceShell`, with two to five places including "more", and refused everywhere else. FE-APP-SHELL-4 of [composition](../composition.md) and lint `starci-grammar/no-shell-bottom-tabs` (`FE_APP_SHELL_BOTTOM_TABS`, R316) say the same: a `BottomNav` in that slot passes; a hand-made bottom tab bar, any other `compactNavigation` and a `BottomNav` anywhere else are refused. `DNA-COMMON-NO-BOTTOM-TABS` measures it in the render.

Stories: `Compositions/Bottom nav (0.46.0)` (`Phone`, `MoreSheet`, `Links`, `Wide`).
