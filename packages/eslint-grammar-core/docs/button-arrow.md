# Button arrows

Law module: `button-arrow.ts`. Finding code: `FE_BUTTON_ARROW`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#BUTTON-ARROW`.

A Button that leads somewhere (a page, a tab, a next step) ends with the Grammar arrow: `endArrow`. It slides toward the reading end on hover and focus and is mirrored in RTL. A primary Button that does something may start with a `startGlyph`. A typed `→` or a passed-in arrow icon does neither, so the law refuses them. Start and end keep their meaning: the start says what the action is, the end says where it goes.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/no-typed-arrow`

No typed arrow characters; a direction is a Grammar icon.
In product source, an arrow character in rendered text is a finding (`FE_NO_TYPED_ARROW`, message `typed`) on ANY element, not only a Button:

- JSX text, a string or template literal rendered as a child, and the branches of a conditional;
- a string attribute that is rendered text (`label`, `title`, `aria-label`, `description`, ...); `className`, `href`, `src`, `id`, `key`, `role`, `data-*` and event handlers are not text.

The characters: the Unicode Arrows block U+2190-U+21FF (→ ← ↑ ↓ ↗ ⇒ …), the dingbat arrows U+2794-U+27BF (➔ ➜ …), the long arrows U+27F0-U+27FF (⟶),
and ASCII `->`. i18n message values are JSON the lint does not read; contexts/ui/content.md holds them. That gap is accepted.

```tsx
<Text>Xem đơn →</Text>                 // refused
<Link href="/orders">Xem đơn</Link>    // Link draws its own arrow
<Button href="/runs" endArrow>Xem lượt</Button>
```

## `starci-grammar/button-arrow`

A `Button` bound to `@starci/grammar` is a finding when:

- its label (children text, a string, a template, the branches of a conditional) states a pointing mark `›` or `»` (message `label`; an arrow character anywhere is `no-typed-arrow`);
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
<Button variant="primary" onPress={send} startGlyph="send">Send</Button>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
