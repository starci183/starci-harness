# Tabs: where the pill stands, and how many layers

Law module: `tabs.ts`. Knowledge: `grammar-laws.yaml` `TABS-SWITCH-ZONE`, `TABS-DEPTH`. Component law: `contexts/ui/components/tabs.md`.

Underline tabs switch panels: the page tabs (`Page header.tabs`) and, inside a tab's panel, a region set. The pill (`appearance="primary"`) is a different thing: a mode or period switch of one block's data. Both rules are errors in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/tabs-switch-zone`

Finding code: `FE_TABS_SWITCH_ZONE`. A `<Tabs appearance="primary">` written in JSX is a finding wherever it stands (a page body, under the page tabs, a pane, a drawer). The pill is drawn only as the `switch` header zone of a card, which has no JSX to write. The item checks (two to four options, no `count`, `href` or `isAttention`) stay in `no-primary-tabs-misuse` (R380).

**Invalid**

```tsx
<Page header={{ title, tabs }}>
  <Tabs appearance="primary" label="Views" items={views} selectedKey={view} onSelect={setView} />
</Page>
```

**Valid**

```tsx
<SurfaceCard kind="list" label="Cash" headers={[{ kind: "switch", label: "Period", items: periods, selectedKey: period, onSelect: setPeriod }]} items={rows} empty={empty} />
```

## `starci-grammar/tabs-depth`

Finding code: `FE_TABS_DEPTH`. Two checks over the underline `Tabs` of one file.

- `depth`: a page stacks at most two underline layers, the page tabs and one region set. A `Tabs` is in the panel of another when it stands inside a conditional, `&&` or `switch` case whose test reads the other's `selectedKey`; it is in the page's panel when it stands in the children of a `Page` whose `header` object carries `tabs`. A `Tabs` that is the third layer is the finding. A `Drawer`, `Dialog`, `Modal`, `Popover` or `Sheet` starts its own surface and ends the climb.
- `region`: the second layer is the region set, drawn as `kind="filter"` (13px, tighter gap, its own separator line, since the host draws none). A second layer left at the default `views` look takes the page tabs' size. A dynamic `kind` is not judged.

**Invalid**

```tsx
<Page header={{ title, tabs }}>
  <Tabs label="Views" items={views} selectedKey={view} onSelect={setView} />
</Page>
```

**Valid**

```tsx
<Page header={{ title, tabs }}>
  <Tabs kind="filter" label="Views" items={views} selectedKey={view} onSelect={setView} />
</Page>
```

The rule reads one file. A set whose page tabs are drawn by another file (a layout, or a frame component) is not judged against them.
