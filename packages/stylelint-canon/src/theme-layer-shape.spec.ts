import assert from "node:assert/strict"
import test from "node:test"
import { FILES, lint, lintRule, textAt } from "./testing.ts"

const rule = (code: string, file = FILES.brand) => lintRule("theme-layer-shape", code, file)

test("accepts a light block and a dark block on HeroUI's tokens", async () => {
  const code = `
:root { color-scheme: light; --accent: #7547ff; --background: oklch(97% 0 0); --scrollbar: #ccc; }
.dark { color-scheme: dark; --accent: #9b7bff; --background: oklch(20% 0 0); }
`
  assert.deepEqual(await rule(code), [])
})

test("accepts the dark block as a media query or a data-theme selector", async () => {
  assert.deepEqual(await rule(":root { --accent: #fff; } @media (prefers-color-scheme: dark) { :root { --accent: #000; } }"), [])
  assert.deepEqual(await rule(':root { --accent: #fff; } [data-theme="dark"] { --accent: #000; }'), [])
})

test("the app sets what it chooses: a file with no dark block, or a token in one mode only, is a theme", async () => {
  assert.deepEqual(await rule(":root { --accent: #fff; }"), [])
  assert.deepEqual(await rule(":root { --accent: #fff; --muted: #888; } .dark { --accent: #000; }"), [])
  assert.deepEqual(await rule(":root { --accent: #fff; } .dark { --accent: #000; --muted: #888; }"), [])
})

test("refuses a token that neither HeroUI nor the grammar publishes", async () => {
  const warnings = await rule(":root { --nv-ink: #fff; --accent: #eee; } .dark { --nv-ink: #000; --accent: #111; }")
  assert.equal(warnings.length, 2)
  assert.match(textAt(warnings, 0), /--nv-ink.*not a token HeroUI or the grammar publishes/)
})

test("refuses a selector, a property or an at-rule that is not the brand layer", async () => {
  assert.equal((await rule(".card { --accent: #fff; } :root { --accent: #fff; } .dark { --accent: #000; }")).length, 1)
  assert.equal((await rule(":root { color: red; --accent: #fff; } .dark { --accent: #000; }")).length, 1)
  assert.equal((await rule("@import \"x.css\"; :root { --accent: #fff; } .dark { --accent: #000; }")).length, 1)
})

test("only judges brand.css", async () => {
  assert.deepEqual(await rule(".card { color: red; }", FILES.module), [])
  assert.deepEqual(await rule(":root { --nv-ink: #fff; }", FILES.globals), [])
})

test("the grammar root and its family attribute are not scopes: the app sets HeroUI's tokens on :root", async () => {
  const FAMILY = '.grammar-common-root[data-grammar-family="offset-pop"]'
  for (const selector of [FAMILY, `${FAMILY}[data-grammar-theme="dark"]`, `.dark ${FAMILY}`, ".grammar-common-root"]) {
    const warnings = await rule(`${selector} { --accent: #fff; }`)
    assert.equal(warnings.length, 1, selector)
    assert.match(textAt(warnings, 0), /in brand\.css/)
  }
})

test("a compound selector of light and dark scopes is one block that sets both themes", async () => {
  const code = `
:root,
.light,
.dark { --success-soft: color-mix(in oklab, var(--success) 15%, transparent); --success-soft-foreground: var(--success); }
`
  assert.deepEqual(await rule(code), [])
})

test("a compound selector with one selector that is no theme scope is still refused", async () => {
  const warnings = await rule(":root, .card, .dark { --accent: #fff; }")
  assert.equal(warnings.length, 1)
  assert.match(textAt(warnings, 0), /in brand\.css/)
})

test("accepts every HeroUI token an app may set, the scrollbar and the information tone included", async () => {
  const tokens = ["--scrollbar", "--scrollbar-thumb", "--disabled-opacity", "--surface-shadow", "--segment", "--backdrop", "--radius", "--field-radius", "--tooltip-delay"]
  const tones = ["success", "warning", "danger", "info"].flatMap((tone) => [`--${tone}-soft`, `--${tone}-soft-foreground`, `--${tone}-soft-hover`])
  const block = [...tokens, ...tones].map((name) => `${name}: #eee;`).join(" ")
  assert.deepEqual(await rule(`:root { ${block} } .dark { ${block} }`), [])
})

test("accepts the four app brand tokens of the intent informative, and no other informative name", async () => {
  const block = ["--informative", "--informative-foreground", "--informative-soft", "--informative-soft-foreground"].map((name) => `${name}: var(--info);`).join(" ")
  assert.deepEqual(await rule(`:root { ${block} } .dark { ${block} }`), [])
  const foreign = await rule(":root { --informative-hover: #eee; }")
  assert.equal(foreign.length, 1)
  assert.match(textAt(foreign, 0), /--informative-hover.*not a token HeroUI or the grammar publishes/)
})

test("accepts the font tokens the grammar reads", async () => {
  assert.deepEqual(await rule(':root { --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif; --font-mono: ui-monospace, Menlo, monospace; }'), [])
  const foreign = await rule(':root { --font-display: "Inter", serif; }')
  assert.equal(foreign.length, 1)
  assert.match(textAt(foreign, 0), /--font-display.*not a token HeroUI or the grammar publishes/)
})

test("no rule of the canon refuses a brand layer that sets HeroUI's tokens, whatever the colours", async () => {
  const code = `
:root { --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif; --accent: #7547ff; --accent-foreground: #fff; --success-soft: #fff; --success-soft-foreground: #eee; }
.dark { --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif; --accent: #7547ff; --success-soft: #000; --success-soft-foreground: #111; }
`
  assert.deepEqual((await lint(code, FILES.brand)).map((warning) => `${warning.rule}: ${warning.text}`), [])
})
