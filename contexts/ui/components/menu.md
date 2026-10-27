# Menu

Contract: [Menu](../../grammars/contract.md#menu). Vendor: [Dropdown, Menu](../../vendor/heroui.md#dropdown).

## Job
Hold commands or choices that do not each deserve a visible button: overflow row actions, the account menu, a
language list.

## Choose

Choice `menu.choose.placement`: whether a command is visible or in a menu. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| commit | the command is the view's commit | never in a menu: a visible `Button` (CTA-1) | judgement |
| value | the entries are form values | `select.choose.role` | judgement |
| nav | the entries are navigation destinations | links in the sidebar or a list, not a menu | judgement |
| visible | the item's most frequent command | a visible `neutral` button on the row | candidate: at most one visible command per item |
| overflow | every other row command | a menu behind one icon button named for its item ("More actions for X") | judgement |

## Variants
Entries are grouped in sections with separators between sections; a destructive entry carries the danger tone
and still goes through its confirm (CTA-4). The indicator side is the contract's arrangement.

## Size
Entries are list rows on the ramp; the trigger is an icon button at its row's step ([../scale.md](../scale.md)).

## States
Selection inside a menu (current language, workspace) shows the selected indicator, distinct from focus.

## Owner split
- **Grammar owns:** popover, sections, separators, item anatomy, indicator side, danger tone.
- **Knowledge decides:** what stays visible vs goes into the menu, destructive treatment, grouping.
- **App author decides:** entries, labels, sections, handlers.

## Rules
CTA-4, ACTION-1, FE-APP-SHELL-3. Lint: `starci-grammar/destructive-menu-entry-needs-danger-tone`. Proof: FOCUS-2,
FOCUS-3, A11Y-2.
