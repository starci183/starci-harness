# Sidebar

Contract: [shell](../../grammars/contract.md#shell). Vendor: [ListBox](../../vendor/heroui.md#listbox). The role of the sidebar in the shell is FE-APP-SHELL-1, -4 and -6 of [composition](../composition.md).

## Job
List the places of the app in groups, each with an optional count, as the wide width's navigation (rail or expanded) and as the drawer or sheet of the compact width.

## Choose

Choice `sidebar.choose.count-tone`: what a count on an item says. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| work | the count is work waiting for this person (an approval, an overdue duty) and they must act | `badgeTone: "danger"` (or `"warning"` when it is due, not late) | `DNA-COMMON-NAV-BADGE-TONE` |
| news | the count is an outcome or new material that is good news or just new (a finished report, new input) | `badgeTone: "success"` or `"accent"` | `DNA-COMMON-NAV-BADGE-TONE` |
| info | the count is only to know (updates, total items) | nothing: `neutral` is the default | `DNA-COMMON-NAV-BADGE-TONE` |

One tone means one rule of the app: the same fact takes the same tone on every item and in every bar. A page does not paint counts red for emphasis; a red count is work for the person (ACCENT-5, HIERARCHY-6).

## The tone of a count
`SidebarItem.badgeTone` (0.46.0; `neutral` default, `accent`, `success`, `warning`, `danger`) paints the count on its tint: `x-soft` ground with `x-soft-foreground` ink, neutral is `default` with `default-foreground`, the pairs a `Badge` of the same tone and a `Tabs` count use.
The count is always printed and `badgeLabel` carries its words ("4 waiting for you"), so the tone is never the only signal. In the icon rail (`isCollapsed`) the count overlaps its glyph and keeps its tone over the surface; the capped count (`badgeMax`) shows "9+".
Before 0.46.0 every count was one solid accent; the default is now the neutral tint, so a count that is work for the person sets its tone.

Evidence (Rule 1). NIVO console shell canvas, repository `nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/`: `GRAMMAR-GAPS.md:10` (G2: red when the count is work waiting for the person, grey when it is information; ask `isAttention` or `badgeTone`);
`pages/01-shell-app.html:236-238` (the drawn rail: Office 4 and Duties 3 in red, the rest grey chips; "như `isAttention` của `Tabs`"); `pages/01-shell-app.html:248-251` (the same counts on the bottom bar).

## Destination
`SidebarItem.href` (0.46.0) makes an item a real anchor through the app root's router (a new tab on a modifier press, copy link); `onAction(id)` runs alongside. Without `href` the item is a command and `onAction` is its only effect.

## Size
An item is 40 high with a leading 20 glyph; the count is a pill of the badge step (12 text). The rail is 3.5rem wide, a drawer is the sheet's width.

## States
Expanded, collapsed (icon rail with tooltip names), drawer; an item is current (`aria-current="page"`), hovered, focused, disabled. A disabled item keeps its count.

## Owner split
- **Grammar owns:** the groups, the current mark, the rail, the count's pill and tint, the tooltips of the rail.
- **Knowledge decides:** which tone a fact takes, when a count is shown.
- **App author decides:** `groups`, `selectedKey`, copy, `badgeLabel` and the persistence of the collapsed state.

## Rules
FE-APP-SHELL-1, FE-APP-SHELL-4, FE-APP-SHELL-6, ACCENT-5, HIERARCHY-6, A11Y-2. Stories: `Navigation/Sidebar count tone (0.46.0)`, `Compositions/App shell`.
