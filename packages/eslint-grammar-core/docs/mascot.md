# A Mascot names its asset slot

Law module: `mascot.ts`. Catalogue: R339 FE_MASCOT_ASSET_SLOT_MISSING.

Grammar's `Mascot` renders a character at one size scale (`sm` 96px, `md` 160px, `lg` 240px square, `hero` filling its host's
height up to its cap), always contained on a transparent ground. It carries the asset-slot props (`assetSlot`, `assetSha256`,
`assetPrompt`) that tie the render to the request.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline. It applies to
product source (the route, feature, component, hook, foundation, module and transport tiers and the workspace packages);
a script or a file no slot owns is not judged.

## `starci-grammar/mascot-asset-slot-required`

A `Mascot` element with no `assetSlot`, or with one that names nothing (`""`, `{undefined}`), is a finding, reported on
the element. An element with a spread attribute is not judged: the spread may carry the slot.

**Invalid**

```tsx
<Mascot src="/images/mascot/welcome.webp" size="hero" />
```

**Valid**

```tsx
<Mascot src="/images/mascot/welcome.webp" size="hero" assetSlot="auth.sign-in" assetSha256={sha} />
```

**Finding code:** `FE_MASCOT_ASSET_SLOT_MISSING`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
