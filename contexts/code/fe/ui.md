---
slots: [fe.feature, fe.components, fe.modules.brand]
---
# Composing the grammar, app CSS and glyphs

The one place that says what an app may style. Which component and which rank is [ui](../../ui/README.md); what the
component looks like is the grammar's ([contract](../../grammars/contract.md)).

## FE-UI-1 Compose the selected grammar; the app makes no visual choice

An app renders every visual element through the grammar its `hfs.json` names (`sides.fe.grammar`), driven by
published props (a button by `intent`, never `variant`; the default control size), and adds no second kit, no
CSS-in-JS, no raw form control, heading or image and no local copy of the grammar shell; a capability the grammar lacks, or a defect in one it has, is
fixed in the grammar and released before the app uses it, and until then the screen records the gap.

Why: two apps built from the same grammar and knowledge must come out the same; every visual choice left to an app is
a fork, and a defect shimmed in one app stays in the grammar for every other.

Enforced by: R93 (`grammar-entry`, `vendor-primitive-has-named-owner`), R321 (`no-grammar-shim`), R62
(`no-native-form-control`, `no-native-img`; grammar `no-raw-structural-element`), R319 (`button-intent-required`,
`single-commit-per-render`, `destructive-confirm-in-dialog`, `no-commit-in-collection-item`),
R320 (`control-height`), R313-R317 (grammar `app-shell-frame` and the navbar laws), R318.

## FE-CSS-1 App CSS is layout only

The classes an app writes, all in a colocated `classNames.ts` ([naming.md](naming.md) FE-NAMING-3), arrange the
boxes the app owns (flex and grid, gap, width and measure, order, overflow and scroll) on the grammar's scale only;
paint, tone, radius, shadow, border, font, control size and the padding inside a grammar surface belong to the
grammar, and an app never targets a grammar part with a selector or a passed class.

Why: each of these is a way to fork the design system inside one app.

- When a spacing or radius seems to have no class → the direction is wrong, or the role belongs to the grammar.

Enforced by: R92 (`no-inline-class-name`, `class-names-in-colocated-file`, `cn-arguments-are-single-tokens`,
`no-public-classname-prop`), R61 (`no-arbitrary-value`, `no-raw-brand-value`), R318 (`no-app-surface-paint`,
`no-grammar-internal-selector`, `no-list-panel-padding`).

## FE-CSS-2 `globals.css` imports in the cascade order

`app/globals.css` holds only `@import` and `@source`, in this order: `tailwindcss`, `@heroui/styles/css`, the
selected grammar's stylesheet, `modules/brand/brand.css`, then `@source` lines that each resolve to a real directory
(the grammar's `dist` included). It is the app's one global stylesheet ([FE-CSS-4](#fe-css-4-one-global-stylesheet-per-web-app)): it loads the brand file, and no layout or module imports `brand.css` itself.

Why: the order is the cascade, so brand tokens win deterministically, and an unresolved `@source` silently drops
classes.

```css
@import "tailwindcss";
@import "@heroui/styles/css";
@import "@starci/grammar/common.css";
@import "../modules/brand/brand.css";
@source "../../../../../node_modules/@starci/grammar/dist";
```

Enforced by: R61 (stylelint `globals-import-order`, `globals-shape`, `source-resolves`).

## FE-CSS-3 Colour lives in one brand file

`modules/brand/brand.css` is the only app file with colour values, and an app has ONE (the marketing site, the console and every other web app of a
front end import the same file): it sets HeroUI's tokens (the app's theme, in the modes it chooses; no gate judges its colours), matching the
product's brand record in `.starciwork`. A colour is written in no other place: not in a TypeScript or TSX component (a hex, `rgb()`, `hsl()`,
`oklch()`, a named colour or a Tailwind arbitrary or default-palette colour class: `bg-[#fff]`, `text-[red]`, `bg-red-500`), not in a stylesheet other
than the brand file (the globals only alias `var()` tokens), not in an inline `style`, and not in a canvas generator under `.starcistacks/canvas/gen/`.
The canvas reads `.starcistacks/canvas/tokens.css`, which `node node_modules/@starci/hfs/runtime/scripts/hfs/canvas-tokens.mjs` generates from the brand
file (a stamp line, then the brand layer byte for byte), so the canvas shows the brand the app ships. No other stylesheet, component or TypeScript value
holds a `px` length, declares a grammar token, uses a class selector, `!important`, a CSS module or an off-scale breakpoint.

Why: one file keeps the brand reviewable, the site and the app cannot drift apart, and the grammar's token layer keeps dark mode and contrast its
responsibility.

- When a colour you need has no token → add the token to the brand file (and, if the Grammar lacks the role, mark "cần Grammar"); never write the value where it is used.
- After a brand change → run `canvas-tokens.mjs` and commit `tokens.css`.

Enforced by: R61 (stylelint `raw-brand-value`, `theme-layer-shape`, `no-token-redefinition`,
`token-only`, `no-class-selector`, `no-important`, `no-css-module`, `breakpoint-scale`; `no-raw-brand-value`), R445 (`FE_BRAND_NOT_ONE`,
`FE_BRAND_CANVAS_LITERAL`, `FE_BRAND_CANVAS_TOKENS_STALE`).

## FE-CSS-4 One global stylesheet per web app

A web app loads its CSS through exactly one entry, `src/app/globals.css`, which imports the Grammar stylesheet and `modules/brand/brand.css`
([FE-CSS-2](#fe-css-2-globalscss-imports-in-the-cascade-order)). A route group (the marketing `(site)`, the `(console)`) has no stylesheet of its own: no
`site.css`, and no layout, page or module imports a `.css` file other than `globals.css` (the root layout imports it once). An app without
a `globals.css`, or whose globals import no Grammar stylesheet or no brand file, is refused.

Why: a second global sheet is a second design system for part of the routes, which is how a site and an app of one product end up looking like two.

Enforced by: R446 (`FE_GLOBALS_NOT_ONE`, `FE_GLOBALS_IMPORTS_MISSING`); what the one sheet holds is R61 (stylelint `globals-shape`, `globals-import-order`).

## FE-STATE-PAGES One page per system state

Every system state is drawn by ONE shared page component per kind: the not found page (every `not-found.tsx`), the error page (every `error.tsx` and
the last-resort `global-error.tsx`) and the offline page (every `offline/page.tsx` or `~offline/page.tsx`, where the app has one). The template
ships them as composites (`NotFoundNotice`, `ErrorNotice`, and `GlobalErrorNotice`, which wraps `ErrorNotice` in the document the last-resort boundary must
draw); the boundary files only wire them. Every route group of the app tree, at any depth, carries its own `error.tsx` and `not-found.tsx` wired to the same
components, so a failure or an unknown address inside the site, the console or any other group shows the same page and none falls through to another look.

Why: the 404 and the 500 are the pages a visitor meets when something is wrong; two looks of them in one product say the product is two products.

Enforced by: R447 (`FE_STATE_PAGE_NOT_SHARED`, `FE_STATE_PAGE_GROUP_MISSING`); each draws the Grammar's empty state by convention.

## FE-ICON One glyph vocabulary through one owner

`components/leaves/Icon` is the only importer of the glyph sets: it maps a semantic name to its glyph cuts and hands
the grammar `Icon` a source, so every caller passes a name (`<Icon props={{ name: "moduleChatbot" }} />`) and the
grammar draws it at one size per region; a meaning the base set lacks is added to the extension set
([stack/fe.yaml](../../stack/fe.yaml) `icons`), never drawn inline; an original brand mark is its own declared leaf.

Why: one map keeps stroke, size and metaphor consistent, and the call site decides only the meaning.

Enforced by: R93 (grammar `no-vendor-icon-outside-icon-leaf`, `heroicons-is-the-glyph-vendor`,
`no-icon-size-class`), R286 (grammar `no-inline-svg-outside-brand-mark-leaf`).
