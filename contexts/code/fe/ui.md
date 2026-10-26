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
`button-no-variant`, `single-commit-per-render`, `destructive-confirm-in-dialog`, `no-commit-in-collection-item`),
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
`no-grammar-internal-selector`, `no-list-panel-padding`, `nested-control-variant`).

## FE-CSS-2 `globals.css` imports in the cascade order

`app/globals.css` holds only `@import` and `@source`, in this order: `tailwindcss`, `@heroui/styles/css`, the
selected grammar's stylesheet, `modules/brand/brand.css`, then `@source` lines that each resolve to a real directory
(the grammar's `dist` included).

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

`modules/brand/brand.css` is the only app file with colour values: it sets only tokens the grammar declares, each with
a light and a dark value and the status soft pairs at their contrast minimums, matching the product's brand record in
`.starciwork`; no other stylesheet, component or TypeScript value holds a colour or a `px` length, declares a grammar
token, uses a class selector, `!important`, a CSS module or an off-scale breakpoint.

Why: one file keeps the brand reviewable, and the grammar's token layer keeps dark mode and contrast its
responsibility.

Enforced by: R61 (stylelint `raw-brand-value`, `brand-layer-shape`, `status-contrast`, `no-token-redefinition`,
`token-only`, `no-class-selector`, `no-important`, `no-css-module`, `breakpoint-scale`; `no-raw-brand-value`).

## FE-ICON One glyph vocabulary through one owner

`components/leaves/Icon` is the only importer of the glyph sets: it maps a semantic name to its glyph cuts and hands
the grammar `Icon` a source, so every caller passes a name (`<Icon props={{ name: "moduleChatbot" }} />`) and the
grammar draws it at one size per region; a meaning the base set lacks is added to the extension set
([stack/fe.yaml](../../stack/fe.yaml) `icons`), never drawn inline; an original brand mark is its own declared leaf.

Why: one map keeps stroke, size and metaphor consistent, and the call site decides only the meaning.

Enforced by: R93 (grammar `no-vendor-icon-outside-icon-leaf`, `heroicons-is-the-glyph-vendor`, `no-off-scale-glyph-size`,
`no-icon-size-class`), R286 (grammar `no-inline-svg-outside-brand-mark-leaf`).
