# No raw type size

Law module: `no-raw-type-size.ts`. Finding code: `FE_RAW_TYPE_SIZE`. Knowledge: `runtime/knowledge/ui/presentation/grammar-laws.yaml#TYPE-ROLES`.

Type is a Grammar role (owner, 2026-11-21). An app draws text with `<Text role="label.item">`, or puts the public class of a role (`starci-type-label-item`, dots as dashes) on an element of its own. The ten roles are figure, title.page, title.section, label.item, body, label.field, label.group, caption, badge and code ([presentation](../../../contexts/ui/presentation.md) "The type roles").

## `starci-grammar/no-raw-type-size`

In product source it reports:

- a Tailwind text-size utility in a class string: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl` and larger, or an arbitrary length (`text-[13px]`), with any variant prefix or `/leading` suffix;
- a `fontSize` key of an object (a JSX `style`, a style constant, a chart option) and a `fontSize` JSX attribute;
- a CSS `font-size` declaration written in a string or a template literal.

It leaves alone colour utilities (`text-muted`), the role classes, the app's theme layer (`modules/brand/`, the tokens), Grammar's own sources, and Freestyle and Fragment regions. App stylesheets are judged by the CSS canon: `starci/token-only` refuses a `font-size` that is not a token, and `starci/no-grammar-private-token` refuses the Grammar's type tokens.

**Invalid**

```tsx
<span className="text-sm font-medium">{name}</span>
<div style={{ fontSize: 12 }}>{note}</div>
```

**Valid**

```tsx
<Text role="label.item">{name}</Text>
<span className="starci-type-caption">{note}</span>
```

## Warning now, blocking later

The rule is the family's counting cohort (`COUNTING` in `src/index.ts`): `coreGrammarConfig` runs it at `warn`, and `starci app check --gate lint` reports and counts its findings without failing. **The switch:** when both apps have migrated, delete its entry from `COUNTING` (a Grammar family minor). The rule then runs at error like every other family rule. An app has no override, because its `eslint.config.mjs` is the managed one-liner (R17).

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
