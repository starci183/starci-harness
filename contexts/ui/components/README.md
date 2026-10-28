# Components

One page per component role: **when and how** to use it. What the role *is* in every grammar (anatomy,
variants, the intent x placement map, the size set, states, what a grammar keeps or may change) is the grammar
contract's entry for that role ([../../grammars/contract.md](../../grammars/contract.md)); what HeroUI ships
underneath is [../../vendor/heroui.md](../../vendor/heroui.md). These pages link both and restate neither.

Every page has the same sections, so a hardening always has one place to land:

| Section | Holds |
| --- | --- |
| Job | the one thing the role is for |
| Choose | every decision the author makes about the role, each one decision table (format below) |
| Variants | which declared fact or context picks the variant, and why; never a decision the Choose tables own |
| Size | its steps on [../scale.md](../scale.md) |
| States | which carriers it holds |
| Owner split | grammar owns / knowledge decides / app author decides |
| Rules | rule ids and lint ids, never their text |

## The Choose format

A Choose section is layer 2 of [../../grammars/README.md](../../grammars/README.md#three-layers): what the LLM
decides, read from a table and cited. Each decision is one table, opened by one line:

```text
Choice `<role>.choose.<decision>`: <the question the table answers>
```

| Column | Holds |
| --- | --- |
| Row | a short lowercase key, stable like the anchor; a row is cited, never renumbered |
| When | the condition, stated as facts the spec or the placement already settled (never a look) |
| Choose | the component, intent, step or composition that condition takes |
| Measure | `DNA-...` when a DNA gate already measures the row's outcome; `candidate: <what to count or measure>` when it could be measured; `judgement` when only a reader can tell |

Rules of the format:

- **Exactly one row applies.** The rows of one table exclude each other; when two could apply, the earlier row
  wins and the table says so. A condition no row covers is a gap, recorded in
  [../../decisions/open-ui.md](../../decisions/open-ui.md), not improvised.
- **Cite the row.** A spec, a draw record or a code review names each choice it made as `<anchor>:<row>`, for
  example `tabs.choose.level:region` or `button.choose.intent:dismiss`. The anchor is stable: a renamed decision
  keeps its anchor, a removed one is never reused.
- **One owner per decision.** A decision has one table in the whole tree; a page that depends on another
  page's decision links its anchor and does not copy its rows. Composition rules (`CTA-*`, `COLLECTION-*`) state
  the law; the table that applies it lives on the component page.
- **Measured rows move down.** A `candidate` row whose measure lands in a DNA gate turns into `DNA-...`; the row
  stays as the choice and the law moves to [contract.yaml](../../grammars/contract.yaml) `mustKeep`.

The anchors are found by their opening line; no list of them is kept by hand. Two decisions live outside this
folder because they are not about one role: `scale.choose.step` ([../scale.md](../scale.md#the-ramp)) and
`space.choose.gap` ([../presentation.md](../presentation.md#space)).

## Choosing a role

This table only routes a need to the page whose own Choose tables decide; it is not cited.

| The need | Page |
| --- | --- |
| run a command or follow a destination | [button](button.md) |
| several actions together: a decision with its way out, peer commands on one object | [action-group](action-group.md) |
| frame a route page; name it: trail, heading, status, commands, page tabs | [page-header](page-header.md) |
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
| draw a diagram: an article's Mermaid source, or nodes and edges the app holds | [diagram](diagram.md) |
