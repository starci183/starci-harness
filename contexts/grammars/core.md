# core

`core` is the product and workspace grammar: a quiet neutral page, white surfaces, one violet accent. It keeps
HeroUI's paint and arrangement (`parity: strict`) and expresses itself almost entirely through the token roles,
so it is the closest grammar to the vendor and the reference the contract is checked against.

Owners: values `@starci/grammar src/core/dna.ts` (`STARCI_CORE_DNA`, the family's default palette and geometry),
the default palette as HeroUI tokens `src/core/theme.css` (optional: an app sets its own), the few
scoped rules `src/core/styles.css`, root `CoreGrammarRoot` (`src/core/index.ts`). The laws
`core` keeps beyond the common ones, with their measurements, are [contract.yaml](contract.yaml) `mustKeep.core`
(`DNA-CORE-*`); this file says why.

## Material and why

- **One violet, as a fill.** The accent fills the commit and draws the focus ring, with white text on it. The
  same violet is too dark to read as text on the dark canvas and a hair too light on the secondary surface, so
  every place Common paints the accent as text (links, the current tab, the section eyebrow, the soft accent
  pairing) reads `--accent-soft-foreground` instead. `--accent-soft` is the selected tint that both that foreground and
  `muted` stay legible on. Every pair the default palette combines clears AA in light and dark; an app that sets its
  own tokens owns its contrast.
- **Neutral page, white surfaces.** The canvas is a near-white neutral and surfaces are white, so content and
  the one accent carry the page; status hues appear only for settled facts. Dark is its own palette, not an
  inversion.
- **One edge.** Every surface on the page ground is a card: white, the surface radius, a 1px `--separator` border and the soft
  diffuse card shadow (0.32.0; owner 2026-11-09). A surface nested in a card (a list frame, a table, a notice) keeps the border and
  drops the shadow, so there is one depth and no doubled edge. Captions and titles stay outside the card.
- **Radius from one token.** `--radius` is the control radius, so fields and tooltips take it and the Button
  corner (three times it) exceeds half of every height: Buttons are pills, and a Button skeleton is a pill too.
  Surfaces take the larger surface radius. A Button drawn with the control corner is a defect.
- **Calm motion.** One short duration with a decelerating curve; no meaning rides on motion.
- **Almost no component CSS.** The palette is HeroUI's tokens in `theme.css`, and the sheet keeps a scoped rule for a
  card region the family treats on its own. A card keeps the name where its kind puts it.

## How core fills the contract

| Role | core |
|---|---|
| Card | White material; shadow and a 1px separator border; surface radius; a card that heads a section carries its label outside the material, above it; a tile carries its name inside with its mark; seams run full-bleed; `soft` is the `accentSoft` lavender under the default foreground, `ink` the violet accent with white or black text read from its lightness |
| Button | Vendor variants through the tokens: commit is the violet fill with white text, alternative the neutral fill with accent text; pill corner; vendor press |
| ButtonGroup | Vendor arrangement unchanged |
| Tabs | Underline: accent indicator, current label in `--accent-soft-foreground` |
| Chip | Badge, with or without its dot, as the vendor soft chip: tone tint with its soft foreground |
| Input | Surface-coloured fill, transparent border, control radius; inside a surface the vendor's neutral fill |
| Select | As Input; selection indicator at the end; option rows as List |
| CopyField | As Input; the copy action a muted in-field glyph at the end, the success foreground while copied, danger when the copy failed |
| Dialog | Surface material with the soft shadow; vendor backdrop; overlays keep the grammar through the root |
| Menu | Selection mark at the start (submenu mark at the end), 20px leading glyphs, separators between sections (Common arrangement) |
| List | Vendor rows; selection as a fill without a check where the list is navigation-like; unread rows at the Common unread weight |
| Alert | The vendor Alert on its tone's soft pair, flat: x-soft row, x-soft-foreground glyph, title and description; toasts keep the vendor surface |
| EmptyState | Common's notice on the region's surface; the first-run artwork is Common's `Mascot` at `md` |
| Avatar | Common initials coloured by seed; members ringed in the surface colour; the agent badge hidden below the `sm` step |
| Mascot | Common's scale and transparent ground, inherited unchanged |
| Shell | Common shell painted by `surface` and `separator`; the bar is a solid surface band with a full-width separator |
| Page header | The same band as the bar: `surface` fill and a full-width 1px `separator` hairline at its bottom edge; page tabs stand on the hairline with the accent underline over it |
| Page | Common's frame: the core band, the body in the measure and gutter a region step below it |
| Diagram | The FlowGraph frame (`separator` edge, surface radius, `surface` fill) for both renderers; Mermaid drawn in the root's `surface`, `foreground`, `border` and `muted` tokens |

## Departures

None. `core` inherits every universal rule id and claims no family evidence. Known material consequence: fields
draw their box with a transparent border, so on a white top-level card only `--field-shadow` shows the field,
and `core` does not bind it (code follow-up C-3).

## Lint

`@starci/eslint-grammar-core` (`coreGrammarConfig`). Its rules are Common-API checks every grammar needs; `core`
has no rule of its own (a package per grammar is open: [questions](../harness/questions.md) 34).
