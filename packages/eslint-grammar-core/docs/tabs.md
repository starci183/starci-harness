# Tabs: where the pill stands, and how many layers

Law module: `tabs.ts`. Knowledge: `grammar-laws.yaml` `TABS-SWITCH-ZONE`, `TABS-DEPTH`. Component law: `contexts/ui/components/tabs.md`.

Underline tabs switch panels: the page tabs (`Page header.tabs`) and, inside a tab's panel, a region set. The pill (`appearance="primary"`) is a different thing: a mode or period switch of one block's data. Both rules are errors in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/tabs-switch-zone`

Finding code: `FE_TABS_SWITCH_ZONE`. A `<Tabs appearance="primary">` written in JSX is a finding wherever it stands (a page body, under the page tabs, a pane, a drawer). The pill is drawn as the `switch` header zone of a card, which has no JSX to write, and, since 0.37.16, as the value of a row `control` (an object property named `control` in a select item or list row literal, or a JSX attribute `control={...}`, directly or through a fragment, conditional or `&&`): a row-level mode choice such as "Auto | Ask" lives in the row. The item checks (two to four options, no `count`, `href` or `isAttention`) stay in `no-primary-tabs-misuse` (R380).

**Invalid**

```tsx
<Page header={{ title, tabs }}>
  <Tabs appearance="primary" label="Views" items={views} selectedKey={view} onSelect={setView} />
</Page>
```

**Valid**

```tsx
<SurfaceCard kind="select" label="Agent" selectionMode="multiple" items={[{ id: "send", title: "Send", control: <Tabs appearance="primary" label="Send" items={modes} selectedKey={mode} onSelect={setMode} /> }]} value={value} onChange={setValue} />
<SurfaceCard kind="list" label="Cash" headers={[{ kind: "switch", label: "Period", items: periods, selectedKey: period, onSelect: setPeriod }]} items={rows} empty={empty} />
```

## `starci-grammar/tabs-depth`

Finding code: `FE_TABS_DEPTH`. Over the underline `Tabs` of one file. Every tab is one size, so only the layer count is judged.

- `depth`: a page stacks at most two underline layers, the page tabs and one region set. A `Tabs` is in the panel of another when it stands inside a conditional, `&&` or `switch` case whose test reads the other's `selectedKey`; it is in the page's panel when it stands in the children of a `Page` whose `header` object carries `tabs`. A `Tabs` that is the third layer is the finding. A `Drawer`, `Dialog`, `Modal`, `Popover` or `Sheet` starts its own surface and ends the climb.

**Invalid**

```tsx
<Page header={{ title, tabs }}>
  <Tabs label="Status" items={statuses} selectedKey={status} onSelect={setStatus} />
  {status === "open" && <Tabs label="Inbox" items={inbox} selectedKey={inboxView} onSelect={setInboxView} />}
</Page>
```

**Valid**

```tsx
<Page header={{ title, tabs }}>
  <Tabs label="Status" items={statuses} selectedKey={status} onSelect={setStatus} />
</Page>
```

The rule reads one file. A set whose page tabs are drawn by another file (a layout, or a frame component such as a renderer package) is not judged against them: that link is runtime composition, not an import the rule can follow.
