# Type nesting

Law module: `type-nesting.ts`. Finding code: `FE_TYPE_NESTING`. Knowledge: `runtime/knowledge/ui/presentation/grammar-laws.yaml#TYPE-NESTING`.

Type steps down, or stays equal, as blocks nest ([presentation](../../../contexts/ui/presentation.md) "Nesting and siblings"): text inside a
block is never larger than the block's own heading, blocks of one level share their type, and the reading and lead sizes are the page's
own narration (DNA-COMMON-TYPE-NESTED-NOT-LARGER, DNA-COMMON-TYPE-SIBLINGS-SAME, DNA-COMMON-TYPE-LEAD-PAGE-ONLY).

## `starci-grammar/type-nesting`

In product source it reports what the file states statically:

- `lead`: a `Text` with a literal `role` of `reading.body`, `reading.title` or `lead` inside a `Section`, `SurfaceCard`, `Accordion` or
  `Disclosure`, at any JSX depth, JSX passed through a prop included;
- `level`: a `Section`, `SurfaceCard`, `Accordion` or `Disclosure` with a literal `headingLevel` not deeper than the literal
  `headingLevel` of the nearest such block around it.

A computed role or level is not judged, and a block another file renders around this one is not seen: the live page is measured by
the DNA laws and, for lesson pages, by the app's lesson type probe.

**Invalid**

```tsx
<Section title="Vì sao không dùng một transaction" headingLevel={2}>
  <Text as="p" role="reading.body">{why}</Text>
</Section>
<Section title="Repo tặng bạn" headingLevel={2}>
  <SurfaceCard label="Bản chuẩn StarCi" headingLevel={2} />
</Section>
```

**Valid**

```tsx
<Stack gap="region">
  <Text as="p" role="reading.body">{narration}</Text>
  <Section title="Repo tặng bạn" headingLevel={2}>
    <SurfaceCard label="Bản chuẩn StarCi" headingLevel={3}>
      <Text as="p">{note}</Text>
    </SurfaceCard>
  </Section>
</Stack>
```
