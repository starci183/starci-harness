# @starci/stylelint-canon

The CSS half of the StarCi lint canon (HFS R61 `FE_STYLE_TOKEN_ONLY`). The TypeScript half is
`starci-fe/no-raw-brand-value` in `@starci/eslint-canon-fe`; both use one definition of a *raw brand value*
(`src/lib/brand-value.ts`: a hex colour, a colour function such as `rgb`/`hsl`/`oklch`/`color-mix`, or a `px` length).
Rule ownership follows `FE-RULE-OWNERSHIP` in `contexts/code/fe/index.yaml`; the selected Grammar's lint package owns its component and token API checks.

A repository's `stylelint.config.mjs` is the managed one-liner `starci app sync` renders (and `starci app check` compares, R05/R17):

```js
import { loadAppTokens, starciStylelintConfig } from "@starci/stylelint-canon"

export default starciStylelintConfig({ appTokens: loadAppTokens(import.meta.url) })
```

Peers: `stylelint` (17) and `postcss-value-parser`; exact versions are in `knowledge/stack/pins.yaml`.

## No rule is off

The factory has one option, `appTokens` (custom properties a repository's `globals.css` declares as aliases of grammar
tokens); `loadAppTokens(import.meta.url)` derives it from every `globals.css` under `apps/*/src` and `packages/*/src`, so the
config file holds no repository choice. Any other option throws. The config it returns sets every rule to error, `ignoreDisables: true` (a
`stylelint-disable` comment switches nothing off) and no `ignoreFiles`. `assertEveryRuleOn(config)` throws when a config
turns a rule off, downgrades it, omits it, ignores a file or honours inline disables; call it on a config you extended.

## The law

Colour values exist only in `modules/brand/brand.css`, on HeroUI's tokens, which the app sets in whichever mode it chooses. Everywhere else CSS uses the grammar's tokens.

| Rule | Refuses |
|---|---|
| `starci/token-only` | A `var()` of a token the grammar does not publish; a colour, spacing, radius or typography property whose value is not a token, a `calc()` over tokens or a neutral keyword; a named colour in a shorthand (`border: 0 solid red`). |
| `starci/raw-brand-value` | A hex, colour function or `px` length in any stylesheet except `brand.css`. |
| `starci/no-apply-raw` | `@apply` of an arbitrary value (`bg-[#fff]`, `w-[12px]`) that is not a token reference (`bg-[var(--accent)]`, `bg-(--accent)`). |
| `starci/no-important` | `!important` in a declaration, and `!` on an `@apply` utility. |
| `starci/globals-shape` | In `globals.css`: anything but `@import`, `@source` and `:root`/`.dark`/`[data-theme]`/`@theme` blocks of alias tokens (`var()` values only). |
| `starci/no-token-redefinition` | A grammar token declared (or `@property`-registered) anywhere but `brand.css`, CSS modules included. Local custom properties are fine. |
| `starci/no-grammar-private-token` | A private token of the grammar (`--grammar-*`, `--starci-core-*`, `--offset-pop-*`) read with `var()` or written, in any app stylesheet. |
| `starci/theme-layer-shape` | `brand.css` with a selector other than a light or dark scope (`:root`, `.light`, `.dark`, `[data-theme]`; a compound `:root, .light, .dark` is both), a non-token property, or a token that neither HeroUI nor the grammar publishes. It judges the file's shape and never a colour: no contrast, no pairing of light and dark. |
| `starci/no-inline-lint-config` | `stylelint-disable`, `-enable` and `-disable-next-line` comments. |
| `starci/no-css-module` | Any `*.module.css`. |
| `starci/no-class-selector` | A class selector in a plain app stylesheet (`globals.css`, `brand.css` have their own shape rules). |
| `starci/breakpoint-scale` | A width in `@media` that is not on the grammar's scale (rem, or px at 16px to the rem). |
| `starci/spacing-scale` | A padding, margin, gap or scroll inset (and a custom property carrying one) whose length is off the spacing scale 0 4 8 12 24 32 (rem, or px at 16px to the rem; a 1px or 2px line passes), or fluid (`clamp()`, a viewport unit). Its spec also judges every `@starci/grammar` stylesheet (finding `FE_SPACING_OFF_SCALE`). |
| `starci/source-resolves` | A Tailwind `@source` path that does not exist, resolved from the stylesheet's folder (finding `FE_STYLE_SOURCE_UNRESOLVED`). |
| `starci/globals-import-order` | In `globals.css`: an import outside, or out of, the order `tailwindcss`, `@heroui/styles/css`, a grammar family stylesheet (and its optional `theme.css`), `modules/brand/brand.css`, then `@source`. |

The file kind comes from the path: `**/modules/brand/brand.css` is the brand layer, `globals.css` the global sheet,
`*.module.css` a CSS module, anything else a plain stylesheet. There is no per-file override to turn a rule off.

## The vocabulary

The tokens the rules accept are HeroUI's theme and the grammar's own, read by `src/lib/extract-vocabulary.ts`: every
custom property HeroUI declares (its `variables.css`, snapshotted in `fixtures/heroui`), the status tone `info` that HeroUI
lacks, every custom property under `--grammar-`, `--starci-core-` and `--offset-pop-`, the component-local properties
the grammar declares, and the vendor tokens it reads (`--radius-md`, `--font-mono`). The grammar declares no HeroUI token
on its root, so the app's values in `brand.css` reach every part. `src/lib/vocabulary.generated.ts` is the committed
result; `npm run vocabulary` regenerates it from the committed snapshots in `fixtures/`, and `src/vocabulary.spec.ts` fails
when it is stale or when a grammar root declares a HeroUI token. `npm run vocabulary -- <grammar checkout>/src` first
refreshes the snapshots.

## No gate judges an app's colours

The brand layer is the app's theme. No rule here measures a contrast, a palette or a pairing of light and dark; the
family's own defaults (`@starci/grammar/<family>/theme.css`) are proved in the package's own render proof, for the family's
sake, and block nothing in an app. Status tones follow HeroUI's soft pairing (`--<tone>-soft`, `--<tone>-soft-foreground`);
the vocabulary's `STATUS_TONES` reach `status-text-uses-soft-foreground` in the selected Grammar lint package
(`@starci/eslint-grammar-core` or `@starci/eslint-grammar-offset-pop`).

## Not covered

`raw-brand-value` reads declarations only: a `px` in an `@media` query is judged by `breakpoint-scale` instead. Height
queries are not judged.

## Why

`src/lib/why.ts` (exported as `why`) maps each rule to its finding code (`FE_STYLE_TOKEN_ONLY`, or
`HFS_INLINE_SUPPRESSION` for the suppression rule), a Vietnamese headline with `<file>` / `<what>` placeholders and a
Vietnamese next step, in the shape of eslint-canon-fe's `why`.

```sh
npm run build       # tsc: src/ to dist/
npm test            # typecheck, then node --test "src/**/*.spec.ts"
```
