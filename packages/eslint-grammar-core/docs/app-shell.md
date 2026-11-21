# App shell

Owner: contexts/ui/composition.md

`navbar-control-size` requires the shared 40px height of each bar control through its published API: `Button` and
`IconButton` at `md` (their default), `Switch` as `kind="toggle"` (a stated `kind` wins and the Grammar ignores `size` beside it;
with no `kind`, the toggle unless `size` says `md` or `lg`), every other control at `size="control"`. A `Switch kind="compact"`
(32x18) is refused in the bar with its own message, whatever `size` it carries. Unknown trailing prop spreads
cannot prove a size; put the explicit size after a spread. A left `Drawer` containing
`Sidebar presentation="drawer"` also identifies a mobile bar opener when composed in a separate
client owner. Its trigger is checked; drawer bodies and footers retain their normal field sizes.

| Rule | Invalid composition | Valid composition |
| --- | --- | --- |
| `navbar-control-size` | A navbar `IconButton` uses `size="sm"`; the theme `Switch` is `kind="compact"`. | The `IconButton` keeps `md`; the theme `Switch` is `kind="toggle"`. |

The rule is an error in the gathered FE canon and runs through the ordinary application gate.

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
