# HeroUI: what it ships and why

HeroUI v3 is a set of compound components over React Aria: each component is a root plus named parts, the
behaviour and accessibility come from React Aria, and the paint is vendor CSS that reads semantic variables
(`--accent`, `--surface`, `--default`, `--field-*`, `--radius`, `--shadow-surface`). That split is why a grammar
can re-skin by binding variables without touching anatomy. Exact classes and values are in the generated
reference ([README](README.md#the-vendor-reference-is-generated-not-kept-here)); sizes below were read at the
pinned version and explain the reasoning, not replace the reference.

Four ideas recur across the families, and most variants are one of them:

1. **Emphasis ladder.** Variants rank how loudly a thing asks for attention: a filled accent, a neutral fill
   with accent text, a neutral fill, a border, nothing. Button, Chip and Badge use it.
2. **Tone x emphasis.** Status components separate which fact (`color`/`status`: default, accent, success,
   warning, danger) from how loud (`variant`). A soft emphasis puts the tone in the text over a tint.
3. **Surface ladder.** `surface.css` defines default, secondary, tertiary and transparent surfaces, shared by
   Card, Accordion, Alert, Popover, Modal, Drawer, Dropdown, Select and the pickers. A variant there is a level,
   not an emphasis.
4. **Secondary means inside a surface.** Fields, Tabs and Table each ship a `secondary` look meant for content
   that already sits on a surface, where the primary look (a white fill, a tray) would vanish or double up.

States are data attributes on the root (`data-hovered`, `data-pressed`, `data-focus-visible`, `data-disabled`,
`data-pending`), hover applies only where the device can hover, and focus is drawn only for keyboard focus.

## Button

Root only (no parts); it embeds a Spinner for `isPending`. Variants `primary`, `secondary`, `tertiary`,
`outline`, `ghost`, `danger`, `danger-soft`; sizes `sm`, `md`, `lg`; `isIconOnly`, `fullWidth`; default `md`
`primary`. The variants are the emphasis ladder plus the danger pair: primary is the accent fill with its
foreground, secondary a neutral `--default` fill with accent-soft text, tertiary the neutral fill with neutral
text, outline a border with no fill, ghost nothing until hover, danger and danger-soft the solid and soft
destructive. Pressing scales the button slightly, less for larger buttons. Sizes are touch-first: each steps down
4px from the `md` breakpoint. Icon-only is the same square at the size, the glyph one step smaller at `sm`. The
corner is `rounded-3xl`, three times `--radius`, so with a mid-size radius every Button is a pill.

House: apps declare `intent` and the grammar resolves the variant; sizes are held at every breakpoint; `href`
renders the vendor Link with button paint ([contract](../grammars/contract.md#roles)).

## ButtonGroup

ButtonGroup is Root plus Separator with `orientation` and `fullWidth`, and no size or variant: a group inherits
its buttons'. Its arrangement makes several buttons read as one object: no gap, inner corners squared, outline
borders collapsed between neighbours, the press scale turned off (a scaling button would break the joined edge),
the focused button raised above its neighbours, a short faint separator. House: an action group is only for peers
of one intent.

## ToggleButtonGroup

ToggleButtonGroup is the ButtonGroup arrangement
for toggles plus `isDetached`; ToggleButton repeats the Button size scale with variants `default` and `ghost`.
House: the segmented control wraps ToggleButtonGroup and publishes `sm` and `md` on the shared ramp.

## Tabs

Parts Root, ListContainer, List, Tab, Indicator (required), Separator, Panel; variants `primary`, `secondary`;
`align`; no size prop. `primary` is a segmented pill: the list container is a soft `--default` track, the
selected tab sits on a full-size indicator segment with the surface shadow that slides between tabs, and
separators fade beside the selection. `secondary` is an underline bar: no track, a bottom border, a thin accent
indicator, the selected label in the foreground colour. The tab is 32px and the track pads it to a 40px bar, the
height of an `md` button on touch: tabs align with controls without a size prop. House: names are kept one to one
and the look comes from context (decision D-2).

## Chip

Chip is Root plus Label on the two status axes: `color` default, accent, success, warning, danger, and `variant`
primary (solid tone), secondary (neutral fill, toned text; the default), soft (tone tint, soft text), tertiary
(transparent). Sizes `sm`, `md`, `lg` run about 20 to 28px: chips live below the control scale because they label,
they are not targets. Badge is the same tone x emphasis (primary, secondary, soft) placed on an Anchor at a corner.
Tag is the interactive sibling inside a TagGroup, with a required RemoveButton and grid roles, variants `default`
and `surface`. House: the Badge is the soft small chip; picking among peers is a TagGroup.

## Input

TextField is the field frame (Label, the control, Description, FieldError); InputGroup adds Prefix and Suffix and
squares the input's inner corners beside them. Variants `primary` and `secondary` only, and no size prop.
`primary` is a field on the page: `--field-background` with `--field-shadow`. `secondary` is a field inside a
surface: the neutral `--default` fill and no shadow, because a white field on a white card disappears. Text is
16px on touch and 14px above, since a smaller focused input makes iOS zoom. Every single-line field family
(InputGroup, Select trigger, Search, Number, Date and Time fields) is 36px, one step under a button. House: fields
are 40px so a field and its submit align, and the variant comes from the surface context.

## Select

Select is Trigger, Value, Indicator, ClearButton and Popover (Trigger and Popover required), embedding ListBox,
Label and Description; variants as fields. ComboBox replaces the trigger with an InputGroup. Options are ListBox
items, `min-h-9` rows with a gap and a soft corner: the same 36px row as a menu item, so every list of choices
reads alike. House: the indicator and the option check sit at the end.

## Card

Root, Header, Title, Description, Content, Footer. The variant is a surface level (`default`, `secondary`,
`tertiary`, `transparent`), not an emphasis; padding, a small gap and the surface shadow; the corner is capped so
large radii do not balloon. No size. House: the card's edge follows depth (shadow on the page, border when
nested) and a joined card divides by bands.

## Modal

One anatomy: Trigger, Backdrop, Container, Dialog, Header, Heading, Icon, Body, Footer, CloseTrigger, with Trigger,
Dialog, Heading and CloseTrigger required: an overlay must be named and closable. The variant is the backdrop
(`opaque`, `blur`, `transparent`), not the dialog's paint. Modal size is a maximum width (`xs` to `lg`) plus
`cover` (fills its container) and `full` (edge to edge, no corner or shadow); `scroll` inside or outside.
AlertDialog adds `status` (default danger) and has no `full`. Drawer replaces size with `placement` (bottom by
default, or top, left, right) and adds a Handle with a grab bar. The rhythm is fixed: padded dialog, a small step
from header to body, a larger one to the footer, footer actions at the end with a small gap. Popover is Trigger,
Content, Dialog, Heading and an optional Arrow, on the surface ladder. House: Dialog and Drawer delegate Trigger
and CloseTrigger to the caller; overlays portal into the grammar root.

## Dropdown

Trigger, Popover, Menu, Section, Item, ItemIndicator, SubmenuTrigger, SubmenuIndicator; embeds Label,
Description and Separator. No variant at the root; danger is per item. Items are 36px rows with the indicator at
the start; roles menu, menuitem, menuitemcheckbox, menuitemradio. A Section carries the vendor's separator, so a
wrapper that renders sections without it breaks parity. House: the selection mark at the start, the submenu mark
at the end, 20px leading glyphs, separators between sections.

## Table

Table has fourteen parts (ScrollContainer, Content, Header, Column, SortableColumnHeader, ColumnResizer, Body, Row,
Cell, Footer, LoadMore and more), with Content, Column, Row, Cell and ColumnResizer required. `primary` sits the
table in a secondary-surface tray; `secondary` drops the tray, tints the header and divides rows with faint lines:
the "inside a surface" idea again. Density is fixed: small muted column labels, roomier cells. ListBox is Item,
ItemIndicator and Section, variants `default` and `danger`. House: DataTable wraps Table with a selection
checkbox and delegates the resizer.

## Alert

Alert is Indicator, Content, Title, Description with only `status` (default, accent, success, warning, danger)
and one paint for every status: the surface with its shadow, the tone only on the indicator glyph and the title.
A status is information about the content, not a new surface. HeroUI's Toast is not used: the grammar's Toast is
its own queue (timeouts, persistence for actions and errors, pause on hover and focus) rendering this Alert and a
Spinner.

## Avatar

Image and Fallback parts, `color` on the tone axis, `variant` default or soft, sizes `sm`, `md`, `lg` at 32, 40,
48px: the only vendor family already on an 8px ladder, which is why the house control ramp copies it.
AvatarGroup stacks members with a count. House: the fallback is generated initials coloured by a stable seed, a
bar avatar is `control` size, and a group identity is one composite at one size.

## Small members

Spinner `sm` to `xl`, 16 to 40px; CloseButton and Kbd 24px; Checkbox control 16px; Pagination links one step under Button; ProgressBar and Meter tracks thin; Label small, Description
and errors extra small and muted.

## How sizes align

| Family | sm | md (default) | lg | Size prop | Note |
|---|---|---|---|---|---|
| Button, ToggleButton, icon-only | 36, 32 from `md:` | 40, 36 from `md:` | 44, 40 from `md:` | yes | steps down on desktop |
| Pagination link | 32 | 36 | 40 | yes | one step under Button |
| Tabs bar | | 40 | | no | 32px tab plus the track padding |
| Single-line fields | | 36 | | no | |
| Menu and ListBox row | | at least 36 | | no | |
| Avatar | 32 | 40 | 48 | yes | already an 8px ladder |
| Chip, Badge, Tag | about 20 | about 24 | about 28 | yes | labels, below the controls |
| Spinner | 16 | 24 | 32 (xl 40) | yes | glyph scale |

The vendor clusters controls at 36 to 40px with a 4px step and a desktop step-down, and keeps labels and glyphs
on smaller scales; only Avatar is on an 8px 32/40/48 ladder. The house ladder adopts that one: 32, 40, 48 at every
breakpoint, so a row mixing a button, a switch, a field and an avatar shares one height
([contract](../grammars/contract.md#the-shared-scale), decision D-3).
