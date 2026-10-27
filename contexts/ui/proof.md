# Proof

Proof exists only after render. It observes what actually rendered (the computed accessibility tree, the element
holding focus, the measured rectangle, the composed colour, the frame where motion stopped, the claim the page
makes) and never what the source intended. Each criterion names the observation that would falsify it, so a pass
always names something that was looked at. Every number is in [proof/thresholds.yaml](proof/thresholds.yaml);
gates and briefs read the numbers there, never from this prose. Evidence is stored in the selected `.starciwork`
node's evidence bundle.

Composition commits the intent; proof measures the outcome. Where a criterion tests a composition rule it cites
that rule and the shared threshold key instead of restating it.

## Lenses and verdicts

| Lens | Kind | Criteria | Instrument |
| --- | --- | --- | --- |
| Accessibility | gating | A11Y-1..4 | computed tree, measured render |
| Contrast | gating | COLOR-3, COLOR-5 | composed pixels, every theme and state |
| Focus | gating | FOCUS-1..5 | active element trace |
| Motion | gating | MOTION-1..4 | normal and reduced-motion capture pair |
| Render truth | gating | TRUTH-1..4 | claims inventoried and traced to authority |
| Taste | scored | TASTE-1..12 | captures |
| UX | scored | UX-1..11 | a task run (UAT), captures where a rule says so |
| Anatomy source | provenance | ANATOMY-1..5 | reference renders of the installed grammar |
| Brand | provenance | BRAND-1..3 | capture pixels against the brand record |

**Verdict arithmetic** (stated once; the verdict rules A11Y-5, CONTRAST-1, FOCUS-6, MOTION-5, TRUTH-5, TASTE-13 and
UX-12 apply it to their lens):

- A **gating** lens passes only when every criterion passes, at every declared state, theme and viewport. There is
  no mean and no tolerance. A criterion with no observation makes the lens `blocked`, never pass and never fail.
- A **scored** lens scores each criterion 1-5, each backed by its own measurement. `ship` needs no fail on the
  lens's gate set (`verdict.gates`) and a mean of at least `verdict.shipMean`; anything else is `fix-first`. A 3
  means met without conviction, so an inoffensive page is `fix-first`. A score with no measurement is void.
- A scored lens is valid only when the same auditor scored the three calibration anchors
  ([anchor-low](proof/anchor-low.html), [anchor-mid](proof/anchor-mid.html), [anchor-high](proof/anchor-high.html))
  in the same round, each inside its band within `calibration.tolerance`.
- Canon green does not ship a page; a taste `fix-first` stands. Taste may reject a conforming surface, never
  license a non-conforming one.
- A finding records the failing layer (grammar output, family delta, app delta) and the owner; it does not start
  another op. Labels `ship`, `fix-first`, `blocked` are assessments, not release authority.
- Below-volume data cannot complete a density or count criterion; data creation needs its own authorized op.
  A user-accepted exception records the decision reference beside the original failing observation.

## Accessibility (gating)

| Id | Criterion | Falsified by |
| --- | --- | --- |
| A11Y-1 | a field's computed name equals its visible label; its `description` and error are its accessible description; required, invalid, disabled semantics match the facts; the entry survives revalidation | a placeholder as the only name; a red border without invalid semantics |
| A11Y-2 | a glyph-only command's accessible name is its label; decorative glyphs hidden; a meaningful standalone glyph is an image with a name | a tooltip as the only name |
| A11Y-3 | a measurement exposes name, value and bounds equal to the product fact; an unresolved one renders no progressbar | a named progressbar announcing zero for unknown |
| A11Y-4 | every interactive target meets `target.coarse` on coarse pointers and `target.fine` on fine pointers, hit area included; every required control works by keyboard; distinctions survive forced colours and colour removal; nothing required clips at zoom, text scaling or narrow width | a target under the floor; a distinction carried by fill alone |

## Contrast (gating)

| Id | Criterion | Falsified by |
| --- | --- | --- |
| COLOR-3 | command (button) vs destination (anchor, identifiable at rest), selection (state attribute plus a non-colour change) and focus (an outline distinct from selection) stay distinguishable with colour removed; non-text indicators meet `contrast.nonText` | an underline only on hover; focus and selection sharing one fill |
| COLOR-5 | text meets `contrast.text` (large text `contrast.largeText`), soft status pairs and bare status glyphs `contrast.statusSoft`, required boundaries `contrast.nonText`, measured on composed pixels in every theme, in forced colours, and in every state | a token judged without its composed background; one theme measured for all |

A nested field's fill against its surface is recorded, not scored: the field is carried by its fill, label and
focus outline, and the outline meets `contrast.nonText`.

## Focus (gating)

| Id | Criterion | Falsified by |
| --- | --- | --- |
| FOCUS-1 | a visible indicator sits on the exact target, never clipped, surviving any family or app styling; a single-line field draws exactly one ring, on its frame | `outline: none` with no replacement; two nested rings |
| FOCUS-2 | sequential focus order equals visible and task order, forward and back; arrow traversal skips disabled peers; focusing an overflowed peer scrolls it into view | a positive tab index jumping ahead |
| FOCUS-3 | a modal contains focus, closes on Escape and an explicit control, returns focus to the opener; a non-modal region never traps | focus returning to the body |
| FOCUS-4 | the claim is closed by active element, indicator, computed style, DOM order, rectangle and tree captured together, at every width | a screenshot without an active-element trace |
| FOCUS-5 | pointer and keyboard reach the same outcome with one accepted effect; no required action is hover-only; targets do not collide | an action reachable by pointer only |

## Motion (gating)

| Id | Criterion | Falsified by |
| --- | --- | --- |
| MOTION-1 | meaning exists in the static frame: pending keeps its label and busy state; state has a persistent carrier; exiting content leaves no focus stop | a spinner as the only sign of work |
| MOTION-2 | reduced motion changes choreography only; trigger, content, order and final geometry are identical | different content under reduced motion |
| MOTION-3 | timing is the grammar's, measured in the render; the app never sets duration on grammar anatomy | an app duration on a grammar part |
| MOTION-4 | normal, reduced, interrupted and reversed paths settle to a valid state; flashing stays within `motion.flashesPerSecond` | a stale intermediate state |

## Render truth (gating)

| Id | Criterion | Falsified by |
| --- | --- | --- |
| TRUTH-1 | a neutral fact renders neutral under every family paint, state and width | a success tick on a capability statement |
| TRUTH-2 | availability follows authority: an unavailable capability says so with its condition; an unavailable command is disabled; visibility is not permission | affirmative paint over an unavailable fact |
| TRUTH-3 | progress is not an outcome: success appears only after authority confirms; a promised retry or route exists | a success message while pending |
| TRUTH-4 | every claim (text, glyph, tone, placement, motion, state, live region) is inventoried per state and traced to authority; a generated image direction is labelled proposed input, never render proof | copy review offered as evidence |

## Taste (scored)

Gate set: `verdict.gates.taste`. Each criterion's numbers are under its threshold key.

| Id | Criterion | Key |
| --- | --- | --- |
| TASTE-1 | one focal point in three seconds: one heaviest element, the one HIERARCHY-6 named; the page title a scale step above section titles; one anchor per region; the squint test (blur, greyscale) keeps it | `taste.focal` |
| TASTE-2 | no void without a job; a tint marks a real boundary; partial grid rows collapse; void does not grow when narrow | `taste.voidMax` |
| TASTE-3 | stacked text shares left edges; gutters between peers are equal; region edges align or differ by a declared inset; centring carries meaning | `taste.edgeTolerance` |
| TASTE-4 | vertical rhythm is monotonic (region > section > row), equal peers equal, gaps on the closed scale, order kept at every viewport | — |
| TASTE-5 | colour economy: commits per view (CTA-1), accent area (ACCENT-6), status hues only for real outcomes, warnings visibly distinct, badges per entity (DISCIPLINE-1) | `budgets.commitPerView`, `budgets.accentArea`, `budgets.badgesPerEntity` |
| TASTE-6 | type: sizes and weights per region and per view; running text measure; no orphan word in headings; same rank renders the same; lead figures per DISCIPLINE-2 | `type.region`, `type.view`, `type.measureChars` |
| TASTE-7 | shape: one family of corner roles; card depth; equal peers equal elevation; inner corners nest; hairlines per card | `budgets.cardDepth`, `budgets.hairlinesPerCard` |
| TASTE-8 | imagery earns its place: decorative images per view; one signature moment (DISCIPLINE-3); an image is never the band's only justification nor the focal point unless it is the job | `budgets.decorativeImages`, `budgets.signatureMoments` |
| TASTE-9 | density fits the surface class, measured against representative volume, reproducible by a second reader; achieved by grouping, never by shrinking targets | `density.<class>`, `density.reproducibility` |
| TASTE-10 | designed states: loading keeps the anatomy, empty carries title, line and action, error fails in place, nothing jumps when content arrives | — |
| TASTE-11 | touch and feedback: targets per A11Y-4; hover, focus and rest visibly distinct with no layout shift; pending visible on the initiator | `target.*` |
| TASTE-12 | reference match: the direction names reference standards by class, and a reader would sort the surface into that class; `n/a` when the delivery composed nothing | — |

## UX (scored)

Gate set: `verdict.gates.ux`. Measured in a UAT run unless the criterion says capture.

| Id | Criterion | Key |
| --- | --- | --- |
| UX-1 | the task completes unaided to the flow's terminal assertion (alternate paths too), within its time budget | — |
| UX-2 | committed steps stay inside the flow's budget, else the class band; no step only acknowledges the previous one; a returning person is not asked again | `steps.<class>` |
| UX-3 | a wrong input is corrected at its field within the allowed extra steps, every entered value kept, the message naming field and accepted form; paid or destructive commitments have a way back | `steps.correction` |
| UX-4 | feedback within the latency bands: a visible change, then progress on the initiator, then a way out | `latency.*` |
| UX-5 | the destination is within the class's navigation depth; labels are the reader's words; navigation, heading and address agree | `navigationDepth.<class>` |
| UX-6 | no dead ends: every state offers a next action or a way back; empty, success and error states each move on | — |
| UX-7 | place survives back, reload, a shared link and a return | — |
| UX-8 | forms can be filled: persistent labels, field-level errors, keyboard order and Enter, autofill and input-mode hints | — |
| UX-9 | the commit is in thumb reach at the narrowest viewport (lower half or a pinned bar that hides no content); destructive and commit separated by a target width; targets per A11Y-4 (capture) | `target.*` |
| UX-10 | the same verb, place and emphasis for the same action across the flow; repeated patterns behave the same | — |
| UX-11 | words: nouns for things, verbs for controls, units and timezones on figures, no stub copy, one name per concept | — |

## Anatomy source and brand (provenance)

A direction's regions trace to reality: `direction = real render (anatomy) + brand record (surface) + composition
(intent)`.

| Id | Criterion |
| --- | --- |
| ANATOMY-1 | a region named after a component matches that component's reference render of the installed package; when they disagree on containment the render wins; without a render the claim is unproven |
| ANATOMY-2 | the layer chain holds: background, surface, nested controls; a form is one unit on one surface; nested surfaces take depth from their parent ([presentation.md](presentation.md) "The layer chain") |
| ANATOMY-3 | composition is the only place a direction invents, inside a declared app-owned region; every drawn control is wired or marked as a route that does not exist yet |
| ANATOMY-4 | each direction asset records the reference renders and brand revision that produced it; a grammar release marks dependent directions stale |
| ANATOMY-5 | a direction prompt spells containment literally, names the part models get wrong, and grants freedom as two explicit lists (may, may not) |
| BRAND-1 | the commit's fill and the danger colour match the brand record's tokens in that theme; the brand's primary appears; no record means unproven |
| BRAND-2 | the mascot appears only in a declared artwork slot on a surface the brand allows, as a new generation in the masters' style, never the masters' bytes |
| BRAND-3 | every material saturated colour resolves to a brand token or the grammar palette, within tolerance; a deliberate extra colour is declared in the brand record first |
