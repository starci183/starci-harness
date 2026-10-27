# Chip labels start uppercase

Law module: `chip-label.mjs`. Catalogue: R322 FE_CHIP_LABEL_CASE.

A status chip (`StatusDot` with text, a `Badge`, dot or not) is a label read at a glance beside the thing it qualifies, so it starts with an uppercase letter in every language, Vietnamese included. StatusDot capitalises the text it renders; the rule holds the literal where the source writes it.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/chip-label-starts-uppercase`

The children of a `StatusDot` or `Badge` that the source states literally (JSX text, a string literal, a template literal with no expression, and every branch of a conditional or logical expression made of them) do not start with a lowercase letter. The fix uppercases the first letter in place. Text the source cannot show (a translation call, a variable, a template with an expression), a label that starts with a digit or a symbol, and an uncased script are not judged.

**Invalid** (`src/components/blocks/RunList/component.tsx`)

```tsx
<StatusDot tone="success">running</StatusDot>
<Badge tone="warning" isDot>{"queued"}</Badge>
```

**Valid** (`src/components/blocks/RunList/component.tsx`)

```tsx
<StatusDot tone="success">Running</StatusDot>
<Badge tone="warning" isDot>{t("status.queued")}</Badge>
<Badge>3 failed</Badge>
```

**Finding code:** `FE_CHIP_LABEL_CASE`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
