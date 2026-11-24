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
| visible | the item's most frequent command | a visible `border` button on the row | candidate: at most one visible command per item |
| overflow | every other row command | a menu behind one icon button named for its item ("More actions for X") | judgement |

## Variants
Entries are grouped in sections with separators between sections; a destructive entry carries the danger tone
and still goes through its confirm (CTA-4). The indicator side is the contract's arrangement.
A setting that is on or off and takes effect at once ("Show the assistant" in the account menu) is a `{ kind: "switch", id, label, description?, isSelected, onChange }` entry: a `menuitemcheckbox` row with a Switch at its end; the whole row toggles it (press, Enter, Space) and the menu stays open. It is never a one-item multiple-selection section with a check, and never a `Switch` placed inside an item.

## Size
Entries are list rows on the ramp; the trigger is an icon button at its row's step ([../scale.md](../scale.md)).

## States
Selection inside a menu (current language, workspace) shows the selected indicator, distinct from focus; a selected menu row is the accent soft pair with no edge bar, hover the neutral soft fill ([grammars/contract.md](../../grammars/contract.md#list)).

## Owner split
- **Grammar owns:** popover, sections, separators, item anatomy, indicator side, danger tone.
- **Knowledge decides:** what stays visible vs goes into the menu, destructive treatment, grouping.
- **App author decides:** entries, labels, sections, handlers.

## The header menu (TopBar fit)
A site header's three-line menu is the overflow of its row, not a second navigation. `TopBar fit={{ navigationItems, actionItems, overflowLabel }}` draws the links and the actions as data on one line; what does not fit the row's width moves, whole and in order (links first, last to first; then the quiet actions; the primary action last), into a `DropdownMenu` opened by the three-line `IconButton` at the row's end. The trigger exists only while the menu holds something, and it follows the row's own width, not a breakpoint. An action is `{ id, label, emphasis?: "primary" | "secondary", href | onPress }`, a link `{ id, label, href, isCurrent? }`; an app that wants more than one primary action has the wrong page. Never wrap a label, never scroll the row, never hand-build the row (PHONE-1..4, [../presentation.md](../presentation.md#controls-and-headers-on-a-phone)).

## Rules
CTA-4, ACTION-1, FE-APP-SHELL-3, PHONE-1..4 (the header menu). Lint: `starci-grammar/destructive-menu-entry-needs-danger-tone`. Proof: FOCUS-2,
FOCUS-3, A11Y-2.
