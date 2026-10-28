# offset-pop

`offset-pop` is the playful, mobile-first grammar for consumer and learning apps: a cream canvas, objects drawn
like stickers (an ink outline and a hard offset shadow), one pink for the decision. It re-skins HeroUI's paint
inside its scope (`parity: custom`) and keeps every vendor anatomy, role and behaviour, and every Common size,
spacing and arrangement: it changes how things look, never where they are or how big.

Owners: values `@starci/grammar src/offset-pop/dna.ts` (`OFFSET_POP_DNA`: the contract shape plus the `offset`
group), bindings `src/offset-pop/styles.css`, component paint `src/offset-pop/components-{forms,overlays,navigation}.css`,
root `OffsetPopGrammarRoot`. Its decisions are O-1 to O-12 in [open-grammar](../decisions/open-grammar.md);
where the code still differs, the decision names the follow-up. The laws `offset-pop` keeps beyond the common
ones, with their measurements, are [contract.yaml](contract.yaml) `mustKeep.offset-pop` (`DNA-OFFSET-POP-*`);
this file says why.

## Material and why

- **The sticker (O-1).** A top-level object wears a 2px ink outline and an unblurred ink copy of itself displaced
  down and right. The pair is the grammar's face: without the outline the shadow is a floating block, without the
  shadow it is a line drawing. A surface inside another keeps the outline, drops the shadow and takes the
  secondary fill, so nesting reads as a pressed-in pocket, not a second sticker. This departs from the universal
  reading that border and shadow are alternatives, deliberately and only at top depth.
- **Press travels into the shadow.** A pressed object slides by the offset and its shadow collapses, as if pushed
  flat. No meaning rides on it, and reduced motion removes the travel.
- **One pink, as a fill and a ring (O-2).** Pink fills the decision a view asks for, a checked or current state
  inside a control, a real measurement, and the focus ring. Pink is never text: as text it fails contrast on the
  cream, so every accent word reads the deeper `accentText`. The label on pink is ink, because white on this pink
  fails AA and ink passes; the same holds for the critical red. Because one hue marks action, selection, current
  and focus, each keeps a second, non-colour carrier: a fill on the action, an outline for focus, a leading edge
  for selection, an underline or raised pill for current.
- **Outcomes are palette fills with ink text.** Mint, yellow, critical red and blush carry success, warning,
  danger and information wherever a tone is filled; ink stays the text on all of them, in both themes. Neutral is
  never painted.
- **Shadow geometry is one group (O-3).** Offset, outline width and inks are the DNA `offset` group; the press
  vector and every smaller shadow derive from it, and a narrow viewport shrinks the offset and the surface radius
  through the same tokens, never through literals.
- **Real dark.** Plum-black canvas, cream ink for outlines and text, a near-black shadow ink so the offset still
  reads, a lighter `accentText`. Forced colours drop every shadow, keep the outline and turn pink into Highlight.
- **Voice in type.** The display heading is heavy and tight; sizes and ranks stay Common's.

## How offset-pop fills the contract

| Role | offset-pop |
|---|---|
| Card | Sticker at top depth, pocket when nested (O-1); surface radius larger than core's, smaller on narrow viewports; highlight is the one sticker holding the next step |
| Button | Every variant outlined with a small offset and heavy label; press travel; commit is the view's one pink fill with ink text |
| ButtonGroup | Vendor arrangement; the outline replaces the collapsed borders |
| Tabs | Underline in pink with the current label in `accentText`; pill is a raised pink-outlined segment |
| SegmentedControl | Selected segment filled pink with an ink label and outline |
| Chip | Badge as palette tint with ink text, the `muted` Badge with a dashed edge; StatusDot with text a heavy-weight pill and every dot ringed in ink so it reads on cream; a selected `TagGroup` tag turns pink and lifts |
| Input | Ink-outlined box on the surface at the control radius; focus is the hard offset shadow (critical when invalid) over a transparent outline that forced colours turn into a Highlight ring |
| Select | As Input; options as List rows |
| Dialog | Every overlay is a sticker; a drawer throws its shadow away from the edge it came from; the modal backdrop is a blush tint (O-11) |
| Menu | Outlined popover at the control radius; item states as List rows |
| List | Hover is a yellow wash, keyboard focus a pink ring on the row edge, selected a soft pink pocket with a pink leading edge and `accentText` label (O-9); static rows have no hover and a 2px ink seam |
| Alert | Alert `surface` is a sticker with the tone on indicator and title; `soft` is the tone's palette fill with ink text (O-10); stacked toasts are spaced so each shadow clears the next |
| EmptyState | Common's notice on the sticker |
| Avatar | Common initials and agent badge, inherited unchanged |
| Shell | The contract shell: bar, sidebar and left drawer as stickers; no bottom dock (O-4) |
| PageHeader | A surface band closed by the TopBar's ink rule at the outline width, a heavy heading; page tabs stand on the rule with the pink underline over it |

## Departures

| Universal reading | offset-pop | Status |
|---|---|---|
| Border and shadow are alternatives | Both, at top depth only | decided O-1; family evidence in `src/offset-pop/conformance.ts` |
| Selection, destination, command and focus are distinguishable | One pink, distinguished by geometry and state | decided O-2; check every screen where focus, selection and the commit meet with colour removed |

Everything else is inherited: it does not re-space, resize, re-arrange or add a hue.

## What an app must not add

No app border, blur shadow, gradient or second accent on a grammar renderer, and no per-screen palette: the
outline, the offset and the one pink are the grammar, and an extra layer breaks its dark and forced-colours
mappings. Brand adaptation goes only through the declared token names (gap G-14).

## Lint

`@starci/eslint-grammar-offset-pop` (`offsetPopGrammarConfig`) re-exports the Common-API checks and adds none.
`offset-pop` needs no API rule of its own: its decisions are paint, owned by its sheets.
