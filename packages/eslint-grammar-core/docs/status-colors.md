# Status colors: content on a tone background takes the soft pair, a lone mark takes the tone

Law module: `status-colors.ts`. Catalogue: R61 FE_STYLE_TOKEN_ONLY (the status-pair rule for class names; no gate judges the colours an app's theme gives the pair).

A status tone `x` (`success`, `warning`, `danger`, `info`, read from `lib/status-tones.generated.ts`, which is generated from the grammar with the stylelint vocabulary) paints in two ways. Content that sits on a background of the tone uses the pair `x-soft` and `x-soft-foreground`, the way a HeroUI flat Chip does. A mark that stands alone, with no background of the tone behind it, uses `x` itself. A solid fill takes `x-foreground`. The owner's words: "TEXT TRÊN BG THÌ X-SOFT VÀ X-SOFT-FOREGROUND, CÒN NẾU X ĐỘC LẬP THÌ ĐỂ X LUN" (ruling `status-soft-pair-on-background`).

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/status-text-uses-soft-foreground`

Two findings, both read from `className`/`class`, from `cn()`/`clsx()` arguments, conditionals, arrays, constants and `classes` entries, with any variant, opacity or `!`:

- **on a tint** (message `onTint`): a class string that sets `bg-<tone>-soft` and also paints text, an icon or a text decoration with the solid tone of the same tone: `text-<tone>`, `fill-<tone>`, `stroke-<tone>`, `decoration-<tone>`. The content on the tint takes `text-<tone>-soft-foreground`.
- **alone** (message `alone`): `text-<tone>-soft-foreground` (or `fill-`, `stroke-`, `decoration-`) in the `className` of an element when neither that element nor an element that encloses it in the same file sets `bg-<tone>-soft`. A mark with no tint behind it takes `text-<tone>`. A constant, an array in a constant or a `classes` entry is not judged for this finding, since the element that wears it is not in view; a component that receives its tint from another file is judged where the tint is written.

On Offset Pop (`settings.starci.hfs.grammar` is `offset-pop`) the **alone** finding is not reported: the family's light-theme tones are pastel fills and a bare mark wears the soft foreground there (owner choice "1. Pastel"); its dark theme keeps bare x, which the rule does not refuse either.

A bare solid tone (`text-success` with no `bg-success-soft` on the element), the pair on its tint, a solid fill with its own ink, a solid border, ring or outline, and a tone beside a tint of another tone are not findings.

**Invalid** (`src/components/leaves/StatusText/index.tsx`)

```tsx
<span className="bg-success-soft text-success" />
<span className="text-danger-soft-foreground" />
```

**Valid** (`src/components/leaves/StatusText/index.tsx`)

```tsx
<span className="bg-success-soft text-success-soft-foreground" />
<span className="text-success" />
<div className="bg-danger-soft"><span className="text-danger-soft-foreground" /></div>
<button className="bg-success text-success-foreground" />
<div className="border-danger ring-2 ring-warning" />
```

**Finding code:** `FE_STYLE_TOKEN_ONLY`

**Why:** `<file>` colours status content against the owner's pair rule (`<what>`): content on a `bg-<tone>-soft` tint paints with the solid tone, or a mark with no tint behind it paints with the soft foreground.

**Fix:** Content on a background of the tone takes the pair: `bg-<tone>-soft` with `text-<tone>-soft-foreground`. A mark that stands alone, with no background of the tone, takes the tone itself: `text-<tone>`. A solid fill takes `bg-<tone>` with `text-<tone>-foreground`.

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
