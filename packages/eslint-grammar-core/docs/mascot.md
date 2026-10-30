# Generated art renders through Mascot

Law module: `mascot.ts`. Catalogue: R337 FE_GENERATED_ART_OUTSIDE_FRAME, R338 FE_MASCOT_ASSET_SLOT_MISSING.

Generated art is a raster the asset workflow delivers under the public `/images/` tree, as `.webp` or `.png`. Grammar's
`Mascot` renders a character at one size scale (`sm` 96px, `md` 160px, `lg` 240px square, `hero` filling its host's
height up to its cap), always contained on a transparent ground; `MediaFrame` frames a scene or illustration. Both carry
the asset-slot props (`assetSlot`, `assetSha256`, `assetPrompt`) that tie the render to the request. Drawn through a bare
`Image` or `<img>`, the same art takes whatever box each page gives it.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline. Both apply to
product source (the route, feature, component, hook, foundation, module and transport tiers and the workspace packages);
a script or a file no slot owns is not judged.

## `starci-grammar/generated-art-in-mascot-or-media-frame`

A JSX `src` attribute whose value is statically a path under `/images/` ending in `.webp` or `.png` (any case, an
optional query or fragment) is a finding unless its element is a `Mascot` (`Mascot` or `<ns>.Mascot`) or a `MediaFrame`
element encloses it. The value is read from a string literal, an expression container holding one, a template literal
without expressions, or a `const` of the file initialised with one; a source computed at run time is not judged.
`.svg`, `.jpg` and paths outside `/images/` are not generated art here.

**Invalid** (`src/components/blocks/Onboarding/component.tsx`)

```tsx
<Image src="/images/mascot/welcome.webp" alt="" />
```

**Valid** (`src/components/blocks/Onboarding/component.tsx`)

```tsx
<Mascot src="/images/mascot/welcome.webp" size="lg" assetSlot="onboarding.welcome" />

<MediaFrame assetSlot="landing.scene">
  <Image src="/images/scene/landing.webp" alt="" />
</MediaFrame>
```

**Finding code:** `FE_GENERATED_ART_OUTSIDE_FRAME`

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
