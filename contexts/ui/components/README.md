# Components

One page per component role: **when and how** to use it. What the role *is* in every grammar (anatomy,
variants, the intent x placement map, the size set, states, what a grammar keeps or may change) is the grammar
contract's entry for that role ([../../grammars/contract.md](../../grammars/contract.md)); what HeroUI ships
underneath is [../../vendor/heroui.md](../../vendor/heroui.md). These pages link both and restate neither.

Every page has the same sections, so a hardening always has one place to land:

| Section | Holds |
| --- | --- |
| Job | the one thing the role is for |
| Choose | the role against its neighbours, as a need -> role table |
| Variants | which declared fact or context picks the variant, and why |
| Size | its steps on [../scale.md](../scale.md) |
| States | which carriers it holds |
| Owner split | grammar owns / knowledge decides / app author decides |
| Rules | rule ids and lint ids, never their text |

## Choosing a role

| The need | Role |
| --- | --- |
| run a command or follow a destination | [button](button.md) |
| several actions together: a decision with its way out, peer commands on one object | [action-group](action-group.md) |
| switch which panel or area shows | [tabs](tabs.md) |
| choose one value inside a form or toolbar | [segmented-control](segmented-control.md) |
| filter or tag by peer categories; label an outcome; mark a status with a dot | [chip](chip.md) |
| type a value | [text-field](text-field.md) |
| pick from a list too long for segments | [select](select.md) |
| present one subject | [card](card.md) |
| a task that interrupts, or a secondary task beside the page | [dialog-drawer](dialog-drawer.md) |
| commands that do not deserve a visible button | [menu](menu.md) |
| several of one kind of thing | [list-table](list-table.md) |
| report an outcome or a notice | [toast-alert](toast-alert.md) |
| a region with nothing in it yet, or a failed region | [empty-state](empty-state.md) |
| a compact identity beside a name | [identity-mark](identity-mark.md) |
