# core

`core` is the product and workspace grammar: a quiet neutral page, white surfaces, one violet accent. It keeps
HeroUI's paint and arrangement (`parity: strict`) and expresses itself almost entirely through the token roles,
so it is the closest grammar to the vendor and the reference the contract is checked against.

Owners: values `@starci/grammar src/core/dna.ts` (`STARCI_CORE_DNA`, token names and light/dark defaults),
bindings and the few scoped rules `src/core/styles.css`, root `CoreGrammarRoot` (`src/core/index.ts`). The laws
`core` keeps beyond the common ones, with their measurements, are [contract.yaml](contract.yaml) `mustKeep.core`
(`DNA-CORE-*`); this file says why.

## Material and why

- **One violet, as a fill.** The accent fills the commit and draws the focus ring, with white text on it. The
  same violet is too dark to read as text on the dark canvas and a hair too light on the secondary surface, so
  every place Common paints the accent as text (links, the current tab, the section eyebrow, the soft accent
  pairing) reads the themed `accentText` instead. `accentSoft` is the selected tint that both `accentText` and
  `muted` stay legible on. Every pair the sheet combines clears AA in light and dark.
- **Neutral page, white surfaces.** The canvas is a near-white neutral and surfaces are white, so content and
  the one accent carry the page; status hues appear only for settled facts. Dark is its own palette, not an
  inversion.
- **Edge by depth.** A top-level surface is raised by a soft diffuse shadow with no border; a surface inside
  another takes a border and no shadow. Border and shadow are alternatives, so `core` never draws both.
- **Radius from one token.** `--radius` is the control radius, so fields and tooltips take it and the Button
  corner (three times it) exceeds half of every height: Buttons are pills, and a Button skeleton is a pill too.
  Surfaces take the larger surface radius. A Button drawn with the control corner is a defect.
- **Calm motion.** One short duration with a decelerating curve; no meaning rides on motion.
- **Almost no component CSS.** Beyond token bindings the sheet has one scoped rule: the accent re-declared as
  `accentText` where Common paints it as text. A labelled card keeps Common's label row outside the material.

## How core fills the contract

| Role | core |
|---|---|
| Card | White material; top depth shadow without border, nested depth border without shadow (ruling `surfacecard-always-painted`); surface radius; a card floating in content carries its label outside the material, above it; a docked panel carries its title inside as its header (ruling `card-label-placement-per-grammar`); a nested surface is unraised, border without shadow; dividers run full-bleed |
| Button | Vendor variants through the tokens: commit is the violet fill with white text, alternative the neutral fill with accent text; pill corner; vendor press |
| ButtonGroup | Vendor arrangement unchanged |
| Tabs | Underline: accent indicator, current label in `accentText`. Pill: the vendor's soft track and white selected segment with the surface shadow |
| SegmentedControl | Selected segment on `accentSoft` with an accent border |
| Chip | Badge and StatusDot with text as the vendor soft chip: tone tint with its soft foreground |
| Input | Surface-coloured fill, transparent border, control radius; inside a surface the vendor's neutral fill |
| Select | As Input; selection indicator at the end; option rows as List |
| CopyField | As Input; the copy action a muted in-field glyph at the end, the success foreground while copied, danger when the copy failed |
| Dialog | Surface material with the soft shadow; vendor backdrop; overlays keep the grammar through the root |
| Menu | Selection mark at the start (submenu mark at the end), 20px leading glyphs, separators between sections (Common arrangement) |
| List | Vendor rows; selection as a fill without a check where the list is navigation-like; unread rows at the Common unread weight |
| Alert | The vendor Alert: white surface, tone only on the indicator and title (ruling `alert-white-surface`); toasts the same |
| EmptyState | Common's notice on the region's surface |
| Avatar | Common initials coloured by seed; members ringed in the surface colour; the agent badge hidden below the `sm` step |
| Shell | Common shell painted by `surface` and `separator`; the bar is a solid surface band with a full-width separator |
| PageHeader | The same band as the bar: `surface` fill and a full-width 1px `separator` hairline at its bottom edge; page tabs stand on the hairline with the accent underline over it |
| Page | Common's frame: the core band, the body in the measure and gutter a region step below it |
| Diagram | The FlowGraph frame (`separator` edge, surface radius, `surface` fill) for both renderers; Mermaid drawn in the root's `surface`, `foreground`, `border` and `muted` tokens |

## Departures

None. `core` inherits every universal rule id and claims no family evidence. Known material consequence: fields
draw their box with a transparent border, so on a white top-level card only `--field-shadow` shows the field,
and `core` does not bind it (code follow-up C-3).

## Lint

`@starci/eslint-grammar-core` (`coreGrammarConfig`). Its rules are Common-API checks every grammar needs; `core`
has no rule of its own. The contract moves them into `@starci/eslint-grammar-common` (decision D-7).
