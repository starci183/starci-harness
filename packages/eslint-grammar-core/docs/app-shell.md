# App shell

Owner: contexts/ui/composition.md

The application composes `WorkspaceShell viewport="fixed"`. The `app-shell-frame` rule identifies
workspace chrome from a fixed shell, sidebar/navigation slot, workspace identity, HFS layout owner,
or a shell owner combining a bar and sidebar. It rejects hand-written app-frame landmarks and
workspace shells without the fixed viewport. Generic flow-based site chrome stays in its own scope.
`no-shell-bottom-tabs` rejects bottom navigation components and the shell's `compactNavigation` slot.

The `navbar-cluster` rule reads the visible `TopBar` or `NavigationFeatureNav` actions in source order:
tertiary Language `IconButton` triggering `DropdownMenu`, theme `Switch`, notification `IconButton`
triggering `Popover`, account `AvatarButton` triggering `DropdownMenu`. It follows
local JSX constants and components, constant object members, imported Grammar aliases, and namespace imports. Translated
labels may be dynamic; icon sources identify language and notifications. Menu contents and popover
content belong to their overlays and are outside the bar's control sequence. Conditional render
branches are checked separately. Grammar `TopBar` and `NavigationFeatureNav` compositions are app
bars by default. A proven `WorkspaceShell viewport="flow"` with no workspace/sidebar evidence owns
generic site chrome. A shell hosting an imported navbar delegates only after its owned public
export and rendered Base chain prove a `TopBar` or `NavigationFeatureNav` in every alternative.
Workspace exports resolve back to source. Raw or unknown imported headers are red; the actual
bar's own actions are checked where composed. Each lint source snapshot has fresh dependency proofs.

`navbar-control-size` requires `size="control"` on each bar control. Unknown trailing prop spreads
cannot prove a size; put the explicit size after a spread. A left `Drawer` containing
`Sidebar presentation="drawer"` also identifies a mobile bar opener when composed in a separate
client owner. Its trigger is checked; drawer bodies and footers retain their normal field sizes.
`no-navbar-create` places creation on its
own page and rejects create controls in the navbar and its attached menus or popovers. Static
evidence includes literal labels, translated keys with create semantics, and conventional create
handlers. Runtime-generated labels and arbitrary handler behavior need semantic review; the rule
does not execute application code.

| Rule | Invalid composition | Valid composition |
| --- | --- | --- |
| `app-shell-frame` | An app `Shell` returns a hand-written `<header>` and `<nav>`. | `WorkspaceShell viewport="fixed"` owns the app frame. |
| `no-shell-bottom-tabs` | The shell supplies `compactNavigation={<BottomNav />}`. | The shell supplies `navigationDrawer` with a drawer `Sidebar`. |
| `navbar-control-size` | A navbar `IconButton` uses `size="md"`. | The same control uses `size="control"`. |
| `navbar-cluster` | Account precedes notifications, or a language trigger uses a regular `Button`. | Language menu, theme switch, notification popover, account menu use their stated Grammar trigger kinds in that order. |
| `no-navbar-create` | A navbar button or attached menu item creates a record. | The page owns its create action. |

```tsx
// Invalid: the navbar action creates a page record and has a different height.
<TopBar actions={<Button onPress={on.create}>Create</Button>} />

// Valid: a page action belongs to page content.
<SurfaceCard><Button onPress={on.create}>Create</Button></SurfaceCard>
```

All five rules are errors in the gathered FE canon and run through the ordinary application gate.

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
