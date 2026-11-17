# A table has one flat look

Law module: `data-table-surface.ts`. Finding code: `FE_DATA_TABLE_SURFACE`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#DATA-TABLE-SURFACE`.

A `DataTable` has one flat look: no frame, no card, no fill; its title is the `Section` it stands under. The Grammar family 0.45.0 removed its `surface` prop (`card`, `frame`, `none`), so the compiler refuses it where the types are read; this rule names the fix, and applies it, where an app still writes it (a pinned older Grammar, a JavaScript file, an `any` prop).

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/data-table-surface`

A Grammar `DataTable` (named or `G.DataTable`) with a `surface` attribute, whatever its value (message `surface`). A `surface` on another component (`Pane surface`), a non-Grammar `DataTable` and non-product source are not read.

AUTOFIX (`fixable: "code"`): the attribute and the whitespace before it are removed; the table keeps its columns, rows and `footer`.

**Invalid**

```tsx
<DataTable label="Runs" surface="card" columns={columns} rows={runs} />
```

**Valid**

```tsx
<Section title="Runs"><DataTable label="Runs" columns={columns} rows={runs} /></Section>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
