# Button arrows

Law module: `button-arrow.ts`. Finding code: `FE_BUTTON_ARROW`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#BUTTON-ARROW`.

A Button that leads somewhere (a page, a tab, a next step) ends with the Grammar arrow: `endArrow`. It slides toward the reading end on hover and focus and is mirrored in RTL. A primary Button that does something may start with a `startGlyph`. A typed `→` or a passed-in arrow icon does neither, so the law refuses them. Start and end keep their meaning: the start says what the action is, the end says where it goes.

The same module holds `button-icon-primary-only`: only a primary Button carries a leading icon. Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

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
<Button intent="commit" onPress={send} startGlyph="send">Send</Button>
```

## `starci-grammar/button-icon-primary-only`

Code `FE_BUTTON_ICON_PRIMARY_ONLY`. Only the primary Button (`intent="commit"`, the CTA) carries a leading icon. A `Button` bound to
`@starci/grammar` that sets `startGlyph` or `startContent` is a finding unless its `intent` is the literal `"commit"` (message `icon`):
a neutral, alternative, dismiss or destructive Button, a suggestion pill and a row action are text only. A Button with no `intent`
(it renders the secondary step) and one whose `intent` is computed cannot be proven primary, so they are findings too. The Button type
already refuses a start icon on a literal non-primary intent; the rule covers what a type cannot see. `endArrow` is not an icon under
this rule (any intent may lead), and `IconButton` (icon only, named by its label) is not judged.

**Invalid**

```tsx
<Button intent="neutral" startGlyph="plus" onPress={add}>Add</Button>
<Button startGlyph="plus" onPress={add}>Add</Button>
<Button intent={intent} startContent={<Icon source={x} />} onPress={add}>Add</Button>
```

**Valid**

```tsx
<Button intent="commit" startGlyph="plus" onPress={add}>Add</Button>
<Button intent="neutral" href="/runs" endArrow>View runs</Button>
<Button intent="alternative" onPress={edit}>Edit</Button>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
