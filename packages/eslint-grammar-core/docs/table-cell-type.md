# Table and row type

Law module: `table-cell-type.ts`. Finding code: `FE_TABLE_CELL_TYPE`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#TABLE-CELL-TYPE`.

The text of a table cell or a list row is read in a column of equals, so it takes the final type scale: 14px for the text (the primary 14 / 500 `<Text isStrong>`, the secondary 14 muted; `sm` equals `md`) and 12px only for small names (`<Text size="xs" tone="muted">`: meta, count, timestamp). A Text above 14 (`lg`, `xl`, `figure`), a `Heading`, a `Label` or an `h1`-`h6` there is a heading drawn in a list.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/table-cell-type`

Inside the places below, a `Text` with a literal `size` other than `xs`, `sm` or `md` (`lg`, `xl`, `figure`), any `Heading`, any `Label` and the tags `h1`-`h6` are findings:

- the function a `DataTable` takes as `renderCell` (inline, or a function or arrow declared by name in the file), and the `editor` function of a column object in its `columns` literal;
- the `title` and `description` of a ListRow data object: a row of the `items` of a list collection (`{ kind: "list", items }`, or `Section` / `SurfaceCard` written `kind="list"`, also through a `.map` callback), or the `row` of a `<ListRow>`.

A row list declared elsewhere and passed by name is not followed. A `figure` Text outside a cell or row (a KPI) is not judged.

**Invalid**

```tsx
<DataTable renderCell={(row) => <Text size="figure">{row.name}</Text>} … />
<Section kind="list" items={rows.map((r) => ({ id: r.id, title: <Heading level={3}>{r.name}</Heading> }))} />
```

**Valid**

```tsx
<DataTable renderCell={(row) => <Text isStrong>{row.name}</Text>} … />
<Section kind="list" items={rows.map((r) => ({ id: r.id, title: r.name, description: r.note }))} />
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
