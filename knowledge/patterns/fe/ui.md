---
slots: [fe.feature, fe.components, fe.modules.brand]
---
# Composing the grammar, app CSS and glyphs

The one place that says what an app may style. Which component and which rank is [ui](../../ui/README.md); what the
component looks like is the grammar's ([contract](../../grammars/contract.md)).

## FE-UI-1 Compose the selected grammar; the app makes no visual choice

An app renders every visual element through the one grammar its `hfs.json` names (`sides.fe.grammar`), imported from
that grammar's published entry and driven by published props. It adds no second kit, no CSS-in-JS and no local
recipe for a component the grammar owns. A visual capability the grammar lacks is added to the grammar and released
before the app consumes it; until then the screen records the gap (`COMMON_CAPABILITY_MISSING`). Shells follow the
app-shell rules of [ui/composition](../../ui/composition.md).

Why: two apps built from the same grammar and the same knowledge must come out the same; every visual choice left
to an app is a fork that drifts.

Enforced by: R93 FE_VENDOR_BOUNDARY, R244 FE_STACK_FORBIDDEN, R313-R317, R318 FE_NESTED_VARIANT, R319
FE_BUTTON_INTENT, R320 FE_CONTROL_HEIGHT.

## FE-CSS-1 App CSS is layout only

The classes an app writes, all in a colocated `classNames.ts` ([naming.md](naming.md) FE-NAMING-3), arrange the
boxes the app owns: flex and grid, gap, width and measure, order, overflow and scroll, on the grammar's scale
classes only. Paint, variant, tone, radius, shadow, border, depth, font and control size belong to the grammar,
which resolves them from intent and context; an app never targets a grammar part with a selector or a passed class.

Why: each of these is a way to fork the design system inside one app, and a forked app drifts from every other app.

- When a spacing or radius seems to have no class: the direction is wrong, or the role belongs to the grammar.

Enforced by: R61 FE_STYLE_TOKEN_ONLY, R318 FE_NESTED_VARIANT; lint `no-arbitrary-value`, `no-app-surface-paint`,
`no-grammar-internal-selector`, `no-inline-class-name`, `class-names-in-colocated-file`.

## FE-CSS-2 `globals.css` imports, in a fixed order

`app/globals.css` holds only `@import` and `@source`, in this order: Tailwind, the selected grammar's stylesheet,
`modules/brand/brand.css`, then `@source` lines that each resolve to a real directory.

Why: the order makes brand tokens win deterministically, and an unresolved `@source` silently drops classes.

Enforced by: R61 (FE_STYLE_SOURCE_UNRESOLVED).

## FE-CSS-3 Colour lives in one brand file

`modules/brand/brand.css` is the only app file with colour values. It sets only the brand tokens the grammar
declares, for light and dark, and matches the product's brand record (`.starciwork`). No other stylesheet,
component or TypeScript value holds a colour or pixel literal.

Why: one file keeps the brand reviewable, and the grammar's token layer keeps dark mode and contrast its
responsibility.

Enforced by: R61; lint `no-raw-brand-value`, stylelint canon.

## FE-CSS-4 The grammar is the only token owner

Tokens and their values belong to the grammar package; an app or a shared front-end package declares no
grammar-namespaced custom property, no colour literal, no `*.module.css`, no class selector, no `!important` and no
breakpoint outside the grammar's scale. A product that wants different values gets them as a grammar (or a brand
token the grammar declares), never as an app stylesheet.

Why: two token owners produce two dark modes and two contrast decisions.

Enforced by: R61, R63 FE_PACKAGE_SHAPE, stylelint canon.

## FE-ICON One glyph vocabulary through one owner

Glyph components are imported in one app owner, `components/leaves/Icon` (the meaning-to-glyph map), and passed to
the grammar's icon props; the grammar draws them at its cut and size, one size per region. A meaning the base set
lacks is added to its extension set ([stack/fe.yaml](../../stack/fe.yaml) `icons`), never drawn inline or taken from a
second set; an extension never duplicates a base glyph. An original brand mark has its own declared brand-mark leaf.

Why: one set keeps stroke, size and metaphor consistent, and the call site decides only the meaning.

Enforced by: R93, R286 FE_COPY_IN_CALL; grammar lint `no-vendor-icon-outside-icon-leaf`,
`no-inline-svg-outside-brand-mark-leaf`.
