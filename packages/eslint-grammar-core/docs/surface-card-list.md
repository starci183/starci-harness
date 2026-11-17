# A list is one thing, never a card

Law module: `surface-card-list.ts`. Finding code: `FE_SURFACE_CARD_LIST`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#LIST-ONE-LOOK`.

A list is `Section kind="list"` of `ListRow`s wherever it stands (the page canvas, a card body, a drawer, a pane band, a rail): plain rows
on the surface, divided by hairlines, the rows aligned with the section title, with no frame, fill, radius or shadow. A list is never a
card; cards stay for real objects. The Grammar family 0.43.0 removed `SurfaceCard kind="list"`, so the compiler refuses it where the
types are read; this rule names the fix where an app still writes it.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/surface-card-list`

A Grammar `SurfaceCard` whose `kind` is the literal `"list"` (message `list`). A `kind` that is not a literal is left to the compiler.

There is no autofix: `label` becomes `title` and `labelEnd` becomes `action`, the card's zones have no list form (a filter or search
is the list's `filter`; figures and a list together are a body card holding both), the import changes, and the look changes from a
card to flat rows.

**Invalid**

```tsx
<SurfaceCard kind="list" label="Runs" labelEnd={<Link variant="head" href="/runs">View all</Link>} items={runs} empty={empty} />
<MessageCard title="Workflow paused" body={<SurfaceCard kind="list" layout="suggestions" ariaLabel="Replies" items={replies} empty={null} />} />
```

**Valid**

```tsx
<Section kind="list" title="Runs" action={<Link variant="head" href="/runs">View all</Link>} items={runs} empty={empty} />
<MessageCard title="Workflow paused" body={<Section kind="list" layout="suggestions" ariaLabel="Replies" items={replies} empty={null} />} />
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
