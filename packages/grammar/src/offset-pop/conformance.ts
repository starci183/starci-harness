import { COMMON_UI_RULE_IDS, defineGrammarRuleConformance } from "../common/index.js"

/**
 * Offset Pop's rule conformance against the canonical Common catalogue.
 *
 * The family's CSS is `styles.css` plus the four component sheets it imports
 * (`components-forms.css`, `components-overlays.css`, `components-navigation.css`, `components-content.css`). A rule is
 * FAMILY-owned only when that CSS makes a decision inside the rule's concern; the evidence names the
 * mechanism. Every other rule is inherited: the family declares nothing in its concern, so Common's
 * realization stands unchanged (Core inherits the complete catalogue the same way).
 *
 * Inherited on purpose, although the family is close to them:
 * - The spacing and size rules not listed below: the family's only geometry is the short allow-list
 *   the family promises, each entry owned by a claim here.
 * - ACCENT-3 / COLOR-3: one pink fills the decision action, marks the selected or current state and
 *   draws the focus ring, so distinctness rests on Common's carriers (fill on an action, fill inside a
 *   control, outline, soft pairing, underline), not on hue.
 * - BOUNDARY-3: rows claim it, and the seam stays Common's one line between consecutive rows; the family
 *   only re-binds its width (`--grammar-seam-width`, the 2px outline width, BOUNDARY-5) and adds no edge of its own.
 *
 * Each claim below names the stylesheet rule or renderer that carries it.
 */
/** Renderer ownership guidance, retained as a source contract rather than a published UI rule claim. */
export const OFFSET_POP_SOURCE_OWNERSHIP_EVIDENCE = ["Every family edge lands on a hook a Common owner emits (`data-component`, `data-grammar-*`, the HeroUI slot, or the vendor's own state attribute); the family adds no wrapper shell."] as const

export const OFFSET_POP_FAMILY_EVIDENCE = {
    "ACCENT-1": ["`--accent` binds the one pink. The family fills with it only the decision it marks: the dialog confirm and the toast action (the single action in each; a banner's buttons take its tint), a checked, selected or current state inside a control, the hard offset of the one SurfaceCard with `emphasis=\"accent\"` (the chosen or recommended card), and a real measurement (slider, meter, rating, spinner, the fill of a bar, which is Common's); it never paints text with it."],
    "BOUNDARY-1": ["Band edges are the ink line at `--offset-pop-outline-width`: TopBar below, Footer above; `--border` and `--separator` resolve to the same ink in every theme and CanvasText under forced colours."],
    "BOUNDARY-4": ["Rail draws its inline-end column edge as the 2px `--offset-pop-outline-width` ink line in `--border`; Common draws none on Rail."],
    "BOUNDARY-5": ["Objects carry a `--offset-pop-outline-width` (2px) solid ink outline in place of Common's 1px: nested surfaces, Button, Badge, StateMark, field and choice controls, overlay surfaces, Avatar, tags, pagination, Board cards and counts, SchemaForm marks, the agent's proposal and each ConflictCard side; every part Common draws with its outlined-part edge (`--grammar-border-edge`: a code block, a GradedChoice answer and its key, the other party's message) takes the outline through that one token, which the family root re-binds. Grouped Buttons overlap by one outline width so a shared edge draws once, and every row seam (list rows, disclosure items, notes, schema, schedule and Markdown table rows, DataTable rows and headers, description pairs, upload, media and interval rows) is Common's one between-rows edge at `--grammar-seam-width`, which the family root binds to the outline width: 2px ink, never a second edge, never a per-component width. Core keeps the hairline."],
    "BOUNDARY-6": ["Family-owned departure: a `depth=\"top\"` surface keeps `--surface-shadow` (the hard `0.25rem 0.5rem 0 --offset-pop-shadow-ink` offset) AND the 2px ink outline, the outline-plus-offset signature (overlay surfaces do the same; Board cards and open GradedChoice answers take the small offset); the root re-binds Common's `--grammar-shadow-popover` and `--grammar-shadow-lift` to the hard offset, so a popover, the reaction picker, a lifted Board card and the pane trigger throw it too; forced colours drop the shadow and keep only the outline.", "Shadows stay material, not stacking: `--surface-shadow` and the overlay, drawer and chip offsets are hard ink copies of the outline, nested and forced-colour surfaces have none, and the family sets no `z-index` or `position`."],
    "COLOR-5": ["`theme.css` holds the family's light and `.dark` token values; the family declares no HeroUI token, so an app's own values reach every part. Under `forced-colors` the root and every component sheet reset edges, shadows and selected fills to system colours; the default pairs measure at least 4.5:1 and the focus ring at least 3:1 in light and dark, error text included (danger mixed 65% with the ink)."],
    "FLOW-2": ["The display Heading wraps with `text-wrap: balance`; `overflow-wrap` stays Common's."],
    "FONT-6": ["The display Heading keeps Common's size, and its weight reads `--grammar-weight-black`, which the console scale resolves to 500 (two weights only); the family sets the display tracking (`--grammar-tracking-display`, -.045em) and line height (`--grammar-leading-display`), tighter than Common's."],
    "FOCUS-1": ["`--focus` binds the pink ring (3.22:1 on canvas light, 5.42:1 dark, Highlight under forced colours). It rings a focus-visible whole action's painted frame, a choice control and a slider thumb (2px, 0.25rem offset), and a keyboard-focused ListBox or Select/ComboBox option (2px on the row edge, offset 0, so the list's clip never cuts it); a field shows focus as the hard offset shadow over a transparent 2px outline that forced colours turn into a Highlight ring."],
    "GAP-4": ["Stacked toasts are spaced by `--offset-pop-shadow-y` + 0.5rem (1rem, and .75rem below 40rem) so each hard shadow clears the next toast."],
    "MEASURE-5": ["The family fixes the Meter track at .75rem (.5rem at `size=\"sm\"`) inside its ink outline; every other bar (Progress and its steps, ProportionBar, SegmentBar, FunnelChart) keeps Common's height and draws its ink ring as a spread shadow, so the fill keeps its thickness."],
    "MOTION-1": ["The family's only movement is press travel: a translate plus shadow collapse keyed on `:active` or the vendor's `data-pressed` / `data-dragging`, repeating a press Common already handles; no state or meaning rides on it."],
    "MOTION-2": ["`prefers-reduced-motion: reduce` zeroes `--offset-pop-motion-duration` and `--offset-pop-transition`, and every sheet that moves something sets its `transform` or `translate` to none (navigation zeroes its disclosure transitions); the press itself still reaches Common."],
    "MOTION-3": ["Every family transition reads `--offset-pop-transition`, built from the DNA's `--offset-pop-motion-duration` (140ms) and `--offset-pop-motion-easing`."],
    "PADDING-2": ["The current Breadcrumb becomes an outlined pill with a .5rem inline inset."],
    "RESPONSIVE-1": ["Narrow widths change only family shadow geometry: below 40rem `--offset-pop-shadow-y` (0.5rem to 0.25rem) and `--offset-pop-surface-radius` (1.5rem to 1.25rem), which every card surface follows through the re-bound `--starci-core-surface-radius`; no region, hook or content is removed.", "Unlike Core, the family adds a width query, and it changes shadow geometry and the card radius only; every owner hook stays. State paint changes text colour, shadow and pointer only."],
    "STATE-1": ["`[data-grammar-state=\"unavailable\"]` reads in the muted ink (AA, unavailable is not disabled), drops shadow and transform and shows `not-allowed`; `[data-grammar-state=\"pending\"]` only removes pointer events at full paint. Two hooks, never derived from each other."],
    "STATE-5": ["Surface press and focus treatments are keyed on `:has([data-grammar-whole-action]...)`, so a static surface never paints as pressable."],
    "SURFACE-1": ["The HeroUI card root stays no-surface around the painted frame (no edge, transparent, no shadow)."],
    "SURFACE-2": ["Bounded frames and `[data-grammar-surface]` shells paint `--surface` with `--surface-foreground`, both bound to family tokens.", "Material (ink outline, radius, `--surface`, depth shadow) is painted on the bounded `[data-slot=\"card-content\"]` frame and `[data-grammar-surface]` shells; the HeroUI `[data-slot=\"card\"]` root is cleared to no edge, no background and no shadow."],
    "SURFACE-3": ["A nested frame or shell paints `--surface-secondary`, drops the shadow, and keeps `--surface-foreground` (the same ink as `--foreground`)."],
    "SURFACE-4": ["`--accent-soft` binds the secondary surface and `--accent-soft-foreground` the text-safe `--offset-pop-accent-text` (5.09:1 light, 5.61:1 dark)."],
    "TONE-2": ["`Text tone=\"muted\"` reads `--muted` (#675f6c light, #c8bdca dark), at least 4.75:1 on every family surface."],
    "TONE-3": ["the current tab label, a selected menu item and a selected ListBox or Select/ComboBox option (on the `--accent-soft` fill) read `--offset-pop-accent-text`, never the fill pink."],
    "TRUTH-1": ["The inset state stripe is drawn only on rows whose state is not neutral (`:not([data-grammar-state=\"neutral\"])`), and toast and meter tones map each named outcome to its own semantic colour; no neutral tone is painted as success or danger."],
} as const satisfies Readonly<Record<string, ReadonlyArray<string>>>

export const offsetPopRuleConformance = defineGrammarRuleConformance({
    familyId: "offset-pop",
    inheritedCommonRules: COMMON_UI_RULE_IDS.filter((rule) => !(rule in OFFSET_POP_FAMILY_EVIDENCE)),
    familyEvidence: OFFSET_POP_FAMILY_EVIDENCE,
})
