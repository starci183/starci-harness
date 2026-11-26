# Adding to the grammar

How a component enters `@starci/grammar`, or a prop enters a component. Read by anyone proposing one. The tiers are
the ladder below, the card's shape is the `kind` union of [contract](contract.md#card), and the situation each component
answers is a row of [situations](../ui/situations.md); a component that has no row has no job yet.

The default answer is no. Every component is a choice each later author has to make, and a wrong choice is what the owner corrects.

## The laws

Six laws decide every addition; each names what holds it.

| Law | Says | Held by |
|---|---|---|
| 1 One job, one component | if two components could carry a job, one goes, in the same change | the question below; `situations.md` has one component per row |
| 2 A fact in, a look out | a prop states a fact, no prop chooses a look, and a default needs no prop | the prop rules below; types |
| 3 Data before slots, slots before children | a typed field first, then a named slot, `children` only on a frame | tier table; `NoChildren` and `LabelChild` |
| 4 Wrong composition fails in order | it does not compile, then does not lint, then does not render | types, the R-numbered rules, a development throw, DNA laws |
| 5 The app owns its paint, the grammar its structure | neither reaches into the other | [theme](#paint), `starci/theme-layer-shape` |
| 6 A claim names its enforcer | CONTRIB-8, and every enforcer runs | [who holds each proof](../ui/proof.md#who-holds-each-proof) |

## The question to ask first

Before writing anything, answer these in order. Stop at the first that settles it.

1. **Does a component already do this job?** Search the folders of `src/core/<tier>` (the set is what they hold), the
   [situations](../ui/situations.md) and the Choose tables. If yes, use it.
2. **Does an existing `kind`, slot or field cover it?** Add a field, not a component.
3. **Is it a capability or a feature?** Name three unrelated products that would use it, chat, billing and a game say. If you cannot, it
   belongs in the app. A feature that looks generic is still a feature: a pricing tick, a leaderboard medal, a conversation list.
4. **Could an app fill the gap with `Freestyle` for now?** One screen needing it is not a reason. Two apps needing it are.
5. **What is removed or narrowed by adding it?** A new component that overlaps an old one replaces it in the same change.

Write the answers in the change's description. No answer, no component.

## One job

One sentence, no "and". The sentence becomes the Job section of its page. If the props need a mode that changes what the thing is, it is
two components, or one frame with a typed `kind`. A `layout` whose item type changes between values is the warning sign.

## Naming

The name says what it does as a UI role, in English, never a product feature. `PaneGrid`, not a chat
layout. A prop name states a fact (`isDisabled`, `tone`), never a look (`rounded`, `big`), except the Button's one `variant` (primary, border, danger). Vendor names stay when the vendor has
one. No two names mean the same, and nothing is aliased: a renamed thing is renamed in every app in the same change and the old spelling is gone.

## Which tier

The folder is the tier and a check holds it (`data-tier` equals the folder). Pick by what it does, not by size. One ladder serves
the grammar and apps, with `block` added in apps; a tier imports nothing above it.

Choice `tier.choose.component`: which tier a component belongs to. The first row that applies wins.

| Row | When | Tier | State | May import | Props | `children` | Held by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| frame | it owns a region: tracks, an inset, a scroll, a ground, or an overlay; it adds no content of its own | frame | layout or a portal | everything below | role props | yes: this is the tier's job | `starci-grammar/tier-props`; imports by R26 `FE_GRAMMAR_TIER_DIRECTION`, the folder stamp by `FE_GRAMMAR_TIER_STAMP` |
| composite | it draws a fixed anatomy from fields | composite | none beyond a branch's | branches, leaves, lower composites | typed data, `on*`, at most 3 `ReactNode` slots each named for its role | never: `NoChildren` | `starci-grammar/tier-props`; the same R26 checks |
| branch | it holds its own interaction state and reads no data | branch | `useState` for open, selected or draft | leaves, branches | typed data (`items`, `options`), `on*`, named slots | never: `NoChildren` | `starci-grammar/tier-props` |
| leaf | one element or one vendor part | leaf | none beyond the vendor's | the vendor, tokens, leaves | atoms, `on*`, `isLoading` | a string or none: `LabelChild` | `starci-grammar/tier-props` |
| block | an app world: it reads data through hooks (apps only) | block | the app's hooks | composites and below, never a block | `{ shape?, props, on? }` | never | `starci-fe/tier-children`; R26 |

A prop type extends `NoChildren` (`{ children?: never }`) or `LabelChild` (`{ children?: string }`) in a tier that takes no
`children`, so nested JSX fails to compile for every caller. `children` outside a frame, or any new exception, needs the owner's
yes. Each exception has its reason and its holder; no other exists.

| Exception | Reason | Held by |
| --- | --- | --- |
| `Text` inline content | a sentence holds `Code`, `Link`, `Kbd` | R357 `text-inline-only` refuses a block component in it |
| `Freestyle` `className` | the one sanctioned hole, with a stated reason | R341 |
| `Tooltip` behind a leaf | `disabledReason` needs one; the leaf uses the vendor part | the import check sees no upward edge |
| `DataTable` `render` per column | a cell draws from row data; a client branch | R361: no function prop from a server file |
| Vendor field props over budget | parity forwards them | the budget counts own props only |

Import the vendor part rather than climb. A frame is the only tier that takes `children`, and a `Dialog` or `Drawer` body is a
frame's, so overlays need no exception.

## Props

- **Data before slots, slots before children.** A typed field if the content has a shape, a named slot if it does not, `children` only on a frame.
- **A budget.** Leaf 8, branch 12, composite 12 with at most 3 `ReactNode` slots, frame 10. Vendor props forwarded for
  parity do not count. Over budget means two components.
- **No look props.** No `variant` (the Button's three looks excepted), `className`, `style`, colour, radius or size in pixels. A look is resolved from context or kind.
- **Illegal states do not compile.** Use a discriminated union, and make a field required when the look depends on it, as `empty` on a list.
- **Default right.** The component with no optional prop looks correct. A prop that almost everyone sets is a wrong default.
- **No render callbacks on anything a server component may use.** Pre-rendered `ReactNode` fields cross the client boundary; functions do not.

## Composition

State what it may hold and where it may sit, then make the wrong form fail: type first, then lint, then a development throw from context, then a DNA law
on the render. A one-file lint alone is not enough when the usual caller is a wrapper in another file: add the case to the render graph
(`FE_SURFACE_NESTING`). A surface is never placed in a surface. It reads the surface context itself; a caller never passes depth.

## Paint

An app must be able to theme it with HeroUI's tokens alone.

- Read HeroUI tokens first, with no literal fallback and no private token in front.
- Each Grammar has its own style: Core takes every colour from HeroUI's palette tokens (accent, default, success, warning, danger, their soft and foreground pairs, and HeroUI's ground and text tokens) and keeps no palette of its own; Offset Pop and the other Grammars may choose their own. A debt of one Grammar never drives a rule of Core. An app adds a tone (an `info` tone, say) with four tokens in its theme and one `GrammarToneRegistry` declaration; no Core rule reads an undeclared tone token (`npm run check:tones`, `DNA-COMMON-TONE-CUSTOM-COMPLETE`).
- Never write a colour, radius, font family, shadow or duration in a component rule or in TS. Size and weight come from the Common type ramp.
- A tone on its tint uses `x-soft` with `x-soft-foreground`; a mark alone uses `x`.
- Never add a token an app must set. A new token derives from HeroUI's with a default.
- Never judge an app's colours. Contrast belongs to a family's own defaults, in its own stories.

## Accessibility

Name it: every region, icon-only control and overlay has an accessible name the app supplies. Keep the vendor's roles, keyboard and focus (the
parity gate). State non-colour cues. Meet the target floors without redrawing the box. Stop motion under reduced motion. Say what a live region
announces, and when.

## Server safety

A server component imports Grammar components from `@starci/grammar/common`, so a module that calls a React hook, `createContext` or a region wrapper (`withRegionLoading`, `withRegionInert`, `withRegionGeometry`) begins with `"use client"`. Without it the import fails at render with "Attempted to call withRegionLoading() from the server". `npm run check:client` in `packages/grammar` (part of `npm test`) walks `src/core`, `src/common` and `src/offset-pop` and fails on a module that needs the directive and lacks it as its first statement; a frame that only calls `createElement` stays server-safe.

## Skeleton parity

A component that shows content takes `isLoading` (a frame or list component also an `error` slot beside its `empty` slot), and the loading box equals the ready box. Known text stays real, unresolved values lay out
unseen under a shimmer, nothing focusable remains, and the owner of the data carries `aria-busy`. No DNA law measures that the two boxes are equal yet; the `SkeletonParity` stories draw the loading and the ready render, and their committed pictures show a jump.

## What ships with it

All of it, in one change.

| Item | Where |
|---|---|
| Stories: every shape, loading, empty, error, long text | `packages/grammar/src/stories` |
| Contract role: tier, slots, variants, states, laws with measures | `contexts/grammars/contract.yaml`, `contract.md` |
| Lint for each way it can go wrong that a type cannot stop | `eslint-grammar-core` or `eslint-canon-fe`, with a spec, a `why`, a doc page, an R-number in `hfs/rules.yaml` |
| Vendor entry if it wraps HeroUI | `contexts/vendor/wrappers.yaml`, with the rule it applies or a reason for any override |
| A Choose row only for what a type cannot decide | `contexts/ui/components/<role>.md` |
| Version and changelog | `packages/grammar`, CONTRIB-20 |
| A codemod when it replaces something | `packages/hfs`, `starci app codemod` |

Rewrite what it changes rather than adding beside it (CONTRIB-6). Delete what it replaces in the same change (law 1 above).

## Patch or minor

The canon pins give the Grammar family a same-minor range (`~0.21.38`), so a patch reaches every app
inside it with no release of `@starci/hfs`, the canons or the CLI: an app takes it by raising its pin and lockfile, and R15 accepts
it. A minor moves the range, and with it the whole family. Which one a change is follows from what the rest of the family reads:

- **A patch:** a CSS or renderer fix, a new optional prop, a new component, a story, a new DNA law, a runtime copy of `@starci/hfs`
  data an `eslint-grammar-*` package bundles (it moves only with an hfs release, which releases the family anyway).
- **A minor:** a lint rule an `eslint-grammar-*` package adds or changes (its `src/`), a component or prop removed or renamed, a DNA law
  id removed or renamed, a `deprecated` or `forbidden` entry of [contract.yaml](contract.yaml) changed, and a Grammar fact
  `eslint-canon-fe` needs. A minor raises the canon pins' range in `@starci/hfs` (`knowledge/hfs/canon-pins.yaml` and
  [stack/pins.yaml](../stack/pins.yaml)), which releases hfs, the canons and the CLI with it.
- **An hfs minor:** `eslint-grammar-core` peers `@starci/hfs` by a same-minor range, so every hfs minor cuts the family as a patch
  whose peer range names the new hfs line, in the commit that raises hfs ([CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20). A
  Grammar change cut on a branch of an older hfs minor serves that line only; the newer line takes its own patch with the change merged
  (`deps publish-local` warns `PUBLISH_LOCAL_PEER_LINE` on the first and refuses `PUBLISH_LOCAL_PEER_ORPHAN` on an hfs no Grammar
  release installs beside).

No release check judges it; the author does. The three packages keep one version either way ([packages/README.md](../../packages/README.md) "Grammar family versions").

## Codemods

One codemod goes with one Grammar release that needs it, and it is named after that version: 0.54.0 is `v0540`
(`v<major><minor><patch>`). It lives with the Grammar in `packages/grammar/codemods/<id>/`, beside its before/after fixtures
(proven by its dry run on an app, `starci app codemod <id>`, never by a spec: GRAMMAR-NO-TESTS), and it is registered in `packages/grammar/codemods/index.mts`. The package builds the codemods to
`dist/codemods` and publishes them as `@starci/grammar/codemods`. `starci app codemod` (in `@starci/hfs`, `codemod/grammar.mts`)
imports them from the Grammar the app has installed and passes in the app's own TypeScript compiler, so neither package takes a
runtime dependency on the other. An app installs the target Grammar first, and that Grammar carries every codemod up to its version.

- `starci app codemod --list` prints each codemod with its Grammar version and summary.
- `starci app codemod v<major><minor><patch>` is dry by default and prints a per-file summary. `--execute` writes the changes. Cases it cannot decide are
  marked in source with `TODO(type-role)` (each codemod names its marker) and listed; a run that leaves one exits 1.
- `starci app codemod --from <installed> --to <target>` runs every codemod above `<installed>` up to `<target>`, in version order, so an
  app that skips versions upgrades in one go. `--to` defaults to the installed Grammar.
- `starci deps install-local` prints the `--from`/`--to` line when it moves an app's Grammar. It never runs the line.

**The CHANGELOG says which.** Every Grammar release that changes an app-facing API names its migration in its CHANGELOG entry: either
"codemod: vXXXX" (the codemod of that release), "no codemod needed", or "manual steps" followed by the steps.

## Proof by reading

Lint passing says nothing about looks, and a picture proves nothing a reader of the code cannot see: the Grammar takes no shots
([proof](../ui/proof.md) GRAMMAR-NO-TESTS, the owner on 2026-11-26: "Grammar chụp hình làm gì code ra story dc r? Đọc code là dc
mà? Bỏ vụ chụp hình đi, xoá luôn"). A Grammar lane that changes a component changes, in the same lane, its four records:

1. **The code**: the component's folder under `src/<family>/` (its TSX and its CSS).
2. **Its stories**: a story under `src/stories/` that names the component draws every state the change adds or moves, in **both
   families** (Core and Offset Pop) and **light and dark** through the Storybook toolbar, with **real content** (the longest
   translated label, an empty value, a large count; Lorem ipsum hides the failure), **beside its neighbours** (in a card, a pane and a
   row of controls) and, where paint is in question, under a **foreign theme** (HeroUI's tokens set to an unrelated palette, radius and
   font). The story is the proof; a state no story draws is unproven.
3. **Its contract row**: the component's role in [contract.yaml](contract.yaml) (`roles[]`, its `dna` ids and the `mustKeep` laws
   it owns), rewritten to what the component does now.
4. **Its family section**: the part of [common.md](common.md), [core.md](core.md) or [offset-pop.md](offset-pop.md) that says how that
   family fills the role, rewritten the same way (CONTRIB-6).

The harness FAST gate (`starci check --level dev`) prints a `grammar-proof` notice for a component changed without a story that
names it, or without a change to `contract.yaml` or its family's context; the notice does not fail the gate, and the reviewer reads
it. Before review, measure the static laws with `starci dna check --storybook packages/grammar/storybook-static` (it reads the
rendered DOM of the stories and takes no picture); add a narrow container (a drawer or a rail) to a story if the component answers its
container. Every law must be measured, not merely pass: a law with zero matches is not exercised.

## Review of a Grammar change

The reviewer reads the four records above, never a picture: the code against its contract row and family section, the stories for
every state the change claims. The owner reviews anything that changes how a component looks. A green check does not stand in for
this, and a rejection means a rule is missing or wrong: the fix lands in a type, a law or the rule, then the component. The UI audit of
the app screens that use the component is the app's own proof ([project/gallery.md](../project/gallery.md)), run in the app.
