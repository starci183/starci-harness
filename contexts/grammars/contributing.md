# Adding to the grammar

How a component enters `@starci/grammar`, or a prop enters a component. Read by anyone proposing one. The tiers, the `SurfaceCard`
shape and the rule ids it cites as proposed are specified in
[grammar-audit-2026-11](../decisions/grammar-audit-2026-11.md) parts 3, 4 and 7 until the owner approves them and their lanes land.

The default answer is no. Every component is a choice each later author has to make, and a wrong choice is what the owner corrects.

## The question to ask first

Before writing anything, answer these in order. Stop at the first that settles it.

1. **Does a component already do this job?** Search the [canonical set](../decisions/grammar-audit-2026-11.md#72-the-canonical-set) and
   the Choose tables. If yes, use it.
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

The folder is the tier and a check holds it. Pick by what it does, not by size.

| Tier | Choose when | `children` |
|---|---|---|
| leaf | one element or one vendor part | `string` or none |
| branch | it holds its own interaction state | never |
| composite | it draws a fixed anatomy from fields | never |
| frame | it owns a region: tracks, inset, scroll, ground, or an overlay | yes |

A tier imports only below itself. Import the vendor part rather than climb. `children` outside a frame, or any new exception, needs an owner
ruling. Every public prop type extends `NoChildren` or `LabelChild`, so a wrong caller fails to compile.

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
unseen under a shimmer, nothing focusable remains, and the owner of the data carries `aria-busy`. Prove it with the skeleton-parity law.

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

Rewrite what it changes rather than adding beside it (CONTRIB-6). Delete what it replaces in the same change (law 1).

## Render proof

Lint passing says nothing about looks. Before review:

1. Render every story in **both families** (Core and Offset Pop), in **light and dark**, through `starci dna check`.
2. At **real widths: 375, 768 and 1280**, plus a narrow container (a drawer or a rail) if it answers its container.
3. With **real content**: the longest translated label, an empty value, a large count. Lorem ipsum hides the failure.
4. Beside its **neighbours**: in a card, a pane and a row of controls.
5. With a **foreign theme**: HeroUI's tokens set to an unrelated palette, radius and font, to prove nothing is hard-coded.

Every law must be measured, not merely pass: a law with zero matches is not exercised.

## The look, reviewed by a person

Publish the contact sheet from the proof and link it in the change. A person reads the screens, in the state a reader would see them, and
accepts or rejects. The owner reviews anything that changes how a component looks. A green check does not stand in for this, and a rejection
means a rule is missing or wrong (ruling `beautiful-by-eye`): the fix lands in a type, a law or the rule, then the component.
