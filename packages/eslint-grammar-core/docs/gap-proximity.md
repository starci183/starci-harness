# Children stand closer than their container's siblings

Law module: `gap-proximity.ts`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#GAP-PROXIMITY`. Finding code: `FE_GAP_PROXIMITY`.

Inside any container, its children stand at least one step closer than the container stands to its siblings. The gap roles rise strictly: identity 4, inline 8, row 12, section 24, region 32.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/gap-proximity`

A Grammar layout element nested directly in another (through fragments, `cond ? <x/> : null`, `cond && <x/>` and `items.map(() => <x/>)`) whose gap role is not below its parent's is refused. Roles: `Stack` and `Cluster` their literal `gap`; `PaneSection` its `gap` (default `inline`); `Section` row; `Grid` by kind (`cards`, `week`, `week-summary` inline; `sections`, `pair`, `featured`, `form` section; `main-rail` region); `Form` and `Fieldset` section.

Left alone: a `SurfaceCard`, `Drawer`, `Dialog`, `AlertDialog` or `Popover` resets the comparison (a surface is its own edge); a field stack (`Stack gap="section"` whose children are all form controls) directly in a `Form` or `Fieldset`; `Grid kind="main-rail"` as parent or child; a non-literal `gap`; an element in between that is not a layout element.

**Invalid**

```tsx
<Stack gap="section"><Stack gap="section"><Text>A</Text></Stack></Stack>
<Section><Section kind="list" /></Section>
```

**Valid**

```tsx
<Stack gap="section"><Stack gap="row"><Text>A</Text></Stack></Stack>
<Form><Stack gap="section"><Input label="Name" /><Select label="Role" /></Stack></Form>
```

The message names the child and its role, the parent and its role, and the role to use: one step below the parent (a `Section` or a `Grid` fixes its own role, so the parent steps up or the element is not nested there).

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
