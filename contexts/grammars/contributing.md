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
| 5 The app owns its paint, the grammar its structure | neither reaches into the other (ruling `app-owns-theme`) | [theme](#paint), `starci/brand-layer-shape` |
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

The name says what it does as a UI role, in English, never a product feature (ruling `grammar-names-are-generic`). `PaneGrid`, not a chat
layout. A prop name states a fact (`isDisabled`, `tone`, `intent`), never a look (`rounded`, `big`, `primary`). Vendor names stay when the vendor has
one. No two names mean the same, and nothing is aliased: a renamed thing is removed and migrated, and the old spelling goes to `removedVocabulary`.

## Which tier

The folder is the tier and a check holds it (`data-tier` equals the folder). Pick by what it does, not by size. One ladder serves
the grammar and apps, with `block` added in apps; a tier imports nothing above it (ruling `grammar-tier-ladder`).

Choice `tier.choose.component`: which tier a component belongs to. The first row that applies wins.

| Row | When | Tier | State | May import | Props | `children` | Held by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| frame | it owns a region: tracks, an inset, a scroll, a ground, or an overlay; it adds no content of its own | frame | layout or a portal | everything below | role props | yes: this is the tier's job | tier-props lint; `tiers.grammar` import check |
| composite | it draws a fixed anatomy from fields | composite | none beyond a branch's | branches, leaves, lower composites | typed data, `on*`, at most 3 `ReactNode` slots each named for its role | never: `NoChildren` | tier-props lint; the same import check |
| branch | it holds its own interaction state and reads no data | branch | `useState` for open, selected or draft | leaves, branches | typed data (`items`, `options`), `on*`, named slots | never: `NoChildren` | tier-state and tier-props lint |
| leaf | one element or one vendor part | leaf | none beyond the vendor's | the vendor, tokens, leaves | atoms, `on*`, `isSkeleton` | a string or none: `LabelChild` | tier-state and tier-props lint |
| block | an app world: it reads data through hooks (apps only) | block | the app's hooks | composites and below, never a block | `{ shape?, props, on? }` | never | `starci-fe/tier-children`; R26 |

A prop type extends `NoChildren` (`{ children?: never }`) or `LabelChild` (`{ children?: string }`) in a tier that takes no
`children`, so nested JSX fails to compile for every caller. `children` outside a frame, or any new exception, needs an owner
ruling. Each exception has its reason and its holder; no other exists.

| Exception | Reason | Held by |
| --- | --- | --- |
| `Text` inline content | a sentence holds `Code`, `Link`, `Kbd` | lint `text-inline-only` refuses a block component in it |
| `Freestyle` `className` | the one sanctioned hole, with a stated reason | R341 |
| `Tooltip` behind a leaf | `disabledReason` needs one; the leaf uses the vendor part | the import check sees no upward edge |
| `DataTable` `render` per column | a cell draws from row data; a client branch | lint: no function prop from a server file |
| Vendor field props over budget | parity forwards them | the budget counts own props only |

Import the vendor part rather than climb. A frame is the only tier that takes `children`, and a `Dialog` or `Drawer` body is a
frame's, so overlays need no exception.

## Props

- **Data before slots, slots before children.** A typed field if the content has a shape, a named slot if it does not, `children` only on a frame.
- **A budget, counted by lint.** Leaf 8, branch 12, composite 12 with at most 3 `ReactNode` slots, frame 10. Vendor props forwarded for
  parity do not count. Over budget means two components.
- **No look props.** No `variant`, `className`, `style`, colour, radius or size in pixels. A look is resolved from intent, context or kind.
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
- Never write a colour, radius, font family, shadow or duration in a component rule or in TS. Size and weight come from the Common type ramp.
- A tone on its tint uses `x-soft` with `x-soft-foreground`; a mark alone uses `x`.
- Never add a token an app must set. A new token derives from HeroUI's with a default.
- Never judge an app's colours. Contrast belongs to a family's own defaults, in its own stories.

## Accessibility

Name it: every region, icon-only control and overlay has an accessible name the app supplies. Keep the vendor's roles, keyboard and focus (the
parity gate). State non-colour cues. Meet the target floors without redrawing the box. Stop motion under reduced motion. Say what a live region
announces, and when.

## Skeleton parity

A component that shows content takes `isSkeleton`, and the loading box equals the ready box. Known text stays real, unresolved values lay out
unseen under a shimmer, nothing focusable remains, and the owner of the data carries `aria-busy`. No DNA law measures that the two boxes are equal yet; the `SkeletonParity` stories draw the loading and the ready render, and their committed pictures show a jump.

## What ships with it

All of it, in one change.

| Item | Where |
|---|---|
| Stories: every shape, loading, empty, error, long text | `packages/grammar/src/stories` |
| Contract role: tier, slots, variants, states, laws with measures | `contexts/grammars/contract.yaml`, `contract.md` |
| Lint for each way it can go wrong that a type cannot stop | `eslint-grammar-core` or `eslint-canon-fe`, with a spec, a `why`, a doc page, an R-number in `hfs/rules.yaml` |
| Vendor entry if it wraps HeroUI | `contexts/vendor/wrappers.yaml`, with a ruling for any override |
| A Choose row only for what a type cannot decide | `contexts/ui/components/<role>.md` |
| A ruling when the owner decided something | `contexts/decisions/rulings.yaml` |
| Version and changelog | `packages/grammar`, CONTRIB-20 |
| A codemod when it replaces something | `packages/hfs`, `starci app codemod` |

Rewrite what it changes rather than adding beside it (CONTRIB-6). Delete what it replaces in the same change (law 1 above).

## Render proof

Lint passing says nothing about looks. Before review:

1. Render every story in **both families** (Core and Offset Pop), in **light and dark**, at **1920 and 390** wide, device scale factor 2:
   Playwright's `toHaveScreenshot` over the built Storybook (`npm run prove-render` in `packages/grammar`) compares each with its baseline in
   `packages/grammar/proof/baselines`. The baselines are unreviewed: they detect change and approve no look, and the report says "changed",
   never "wrong". A changed picture fails CI; a lane refreshes unreviewed baselines with `npm run prove-render:accept`. Only the pictures in
   `proof/approved.json` are approved (the chat renderer, so far); a change to one needs a person (`npm run prove-render:approve`). Baselines are taken in the pinned Playwright image CI runs in (Linux), never on a laptop.
2. Measure the static laws with `starci dna check --storybook packages/grammar/storybook-static`; add a narrow container (a drawer or a rail) if it answers its container.
3. With **real content**: the longest translated label, an empty value, a large count. Lorem ipsum hides the failure.
4. Beside its **neighbours**: in a card, a pane and a row of controls.
5. With a **foreign theme**: HeroUI's tokens set to an unrelated palette, radius and font, to prove nothing is hard-coded.

Every law must be measured, not merely pass: a law with zero matches is not exercised.

## The look, reviewed by a person

Link the proof report (the `grammar-proof` artifact of CI, or `proof/report`) in the change. A person reads the screens, in the state a reader would see them, and
accepts or rejects. The owner reviews anything that changes how a component looks. A green check does not stand in for this, and a rejection
means a rule is missing or wrong (ruling `beautiful-by-eye`): the fix lands in a type, a law or the rule, then the component.
