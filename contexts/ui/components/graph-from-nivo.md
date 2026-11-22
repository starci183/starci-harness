# Migrating from the nivo-lite FlowGraph

Where each prop of the nivo-lite app's own `FlowGraph` went. The package itself is generic: nothing here is specific to that app.

| NIVO | here |
|---|---|
| `label`, `nodes`, `edges`, `selectedId`, `onSelect`, `onNodePress` | the same |
| `kindTones` | `kindTones` (tone `neutral` is `default`) |
| `legend` (and `FlowGraphLegend`) | `legend` (and `FlowLegend`) |
| `statusLabels` (partial, English default) | `statusLabels`, all six, no default words |
| `showControls`, `minimap`, `minimapLabel` | the same |
| `isInteractive` | `interactive` |
| `direction` | `direction` (default `LR`) |
| `islands` | `islands`, with `islandsWidth` in place of the measured width |
| `isEditable`, `positions`, `onPositionsChange`, `resetLabel` | `editable`, `positions`, `onPositionsChange`, `resetLabel` (a position is the top-left corner, not the centre; a child's is inside its container) |
| `emptyLabel`, `isLoading` | the same (no default English) |
| `layout` (`steps`, `layered`, `radial`, `manual`, `lanes`) | one ELK layered layout, which is what `steps` and `layered` are for NIVO's WorkflowPage and DataSchemaMap; `radial`, `manual` and `lanes` are used by neither, so not carried |
| `headers`, `background`, `fit`, `height`, `isFramed` | not needed: headers belong to `lanes`/`layered` and are unused; the ground is always dotted; the graph always fits on load and fills the height its parent gives (`fill` is a flex parent); the package draws no frame, the app's card is the frame |
| node `id`, `label`, `description`, `icon`, `count`, `href`, `tag`, `chips`, `outputs` | the same (`icon` is a node, no `IconSource`; `href` with `linkComponent` for the router) |
| node `kind` | `kind` (`trigger`, `execute`, `output` are read as `event`, `action`, `end`) |
| node `tone` | `tone` (`GraphTone`: `default`, `accent`, `info`, `success`, `warning`, `danger`, `muted`) |
| node `status` `done`, `running`, `failed`, `waiting`, `skipped` | `done`, `running`, `error`, `wait`, `skipped`; plus `todo`. The old words are still read |
| node `shape` `stadium`, `rect`, `round`, `circle`, `diamond` | `card`, `diamond`; the other four draw as the card, as they do in `steps` |
| node `container` `{ label, chips, childIds, kind, description, exits, note }` | `container` `{ childIds, kind, chips, description, exits, note }`; the label is the node's `label` |
| node `agent` `{ name, avatar }` | `agent` (an avatar slot, `ReactNode`) and `agentName` |
| node `isDimmed`, `isPlaceholder` | `dimmed`, `placeholder` |
| node `size`, `isRoot`, `position` | not needed: they serve `radial` and `manual`; the card size is fixed and `positions` arranges |
| edge `id`, `source`, `target`, `label`, `sourcePort` | the same (`id` is optional) |
| edge `variant` `forward`, `back`, `return` | `variant: "back"` (forward is no variant) |
| edge `isTaken` true / false | `variant: "taken"`; an untaken branch is `skipped` by itself, or `variant: "skipped"` |
| edge `isFallback`, `isPlaceholder` | `variant: "fallback"`, `placeholder` |
| `useGraphPositions` (the browser's storage) | stays in the app: pass its `saved` as `positions` and `save` as `onPositionsChange` |

