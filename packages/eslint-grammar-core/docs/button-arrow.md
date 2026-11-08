# Button arrows

Law module: `button-arrow.ts`. Finding code: `FE_BUTTON_ARROW`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#BUTTON-ARROW`.

A Button that leads somewhere (a page, a tab, a next step) ends with the Grammar arrow: `endArrow`. It slides toward the reading end on hover and focus and is mirrored in RTL. A Button that does something starts with a `startGlyph`. A typed `→` or a passed-in arrow icon does neither, so the law refuses them. Start and end keep their meaning: the start says what the action is, the end says where it goes.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/button-arrow`

A `Button` bound to `@starci/grammar` is a finding when:

- its label (children text, a string, a template, the branches of a conditional) states an arrow: `→ ← ➜ ➔ ⟶ › »` or ASCII `->` (message `label`);
- its `endContent` is an arrow: an element named `Arrow*` or `ChevronRight*`, or an element whose `source`, `glyph` or `name` is such an identifier or a string naming `arrow`, `chevron-right` or `chevron-end` (message `endContent`);
- it sets `endArrow` together with `startGlyph` or `startContent` (message `both`; the Button type refuses the pair as well).

`Button` takes its label as children only, so there is no string label prop to read. `IconButton` has no label and no `endArrow`; `TextAction` takes `endContent` but no `endArrow`; neither is judged.

**Invalid**

```tsx
<Button href="/runs">View runs →</Button>
<Button href="/runs" endContent={<Icon source={ArrowRightIcon} />}>View runs</Button>
<Button href="/runs" endArrow startGlyph="send">View runs</Button>
```

**Valid**

```tsx
<Button href="/runs" endArrow>View runs</Button>
<Button onPress={send} startGlyph="send">Send</Button>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
