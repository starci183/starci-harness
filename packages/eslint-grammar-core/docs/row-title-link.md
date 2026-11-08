# Row titles are not links

Law module: `row-title-link.ts`. Finding code: `FE_ROW_TITLE_LINK`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#ROW-TITLE-LINK`.

When a row opens something, the row is the one pressable and its title is plain text. A `Link` inside the title adds a second target and a second tab stop on the same row for the same destination.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/row-title-link`

- A ListRow data object (a row of the `items` of a list collection, or the `row` of a `<ListRow>`) whose `title` holds a Grammar `Link` while the same object has `onPress`, `onAction`, `href`, `onFollow` or `chevron` (message `row`).
- A `DataTable` whose rows open (`onRowAction`, or an inline `rows` literal or `.map` whose objects carry an `href`) and whose `renderCell` returns a `Link` for the row-header column: the column marked `isRowHeader`, else the first column of an inline `columns` literal. A `Link` in the branch of another column is not judged; a `Link` outside any column branch is (message `cell`).

A row that does not open may hold a link in its title. A Link in the description is not the title.

**Invalid**

```tsx
<Section kind="list" items={[{ id: "a", title: <Link href="/a">A</Link>, href: "/a" }]} />
<DataTable onRowAction={open} renderCell={(row) => <Link href={row.href}>{row.name}</Link>} … />
```

**Valid**

```tsx
<Section kind="list" items={[{ id: "a", title: "A", href: "/a" }]} />
<DataTable onRowAction={open} renderCell={(row) => <Text isStrong>{row.name}</Text>} … />
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
