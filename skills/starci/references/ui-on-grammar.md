# UI on a grammar

A front end is drawn in its grammar: the `@starci/grammar` package owns every component, prop, token and
value. The app owns only product facts (copy, routes, data) and the layout of boundaries it owns. This holds
for a `draw` contract (the screen's direction), an `audit` contract and any `code` contract that touches the front end.

## Resolve the grammar

Read the app's `hfs.json` `sides.fe.grammar`; there is no default grammar, and an unknown one stops you.
Check the installed `@starci/grammar` version and its exports before you name a component or prop. A
capability the package lacks is a gap to record (`COMMON_CAPABILITY_MISSING`), never an API to invent.

## Read in this order

1. `contexts/README.md` at the runtime root, when it exists, for the map of the knowledge tree.
2. [contexts/ui/README.md](../../../contexts/ui/README.md) and
   [composition.md](../../../contexts/ui/composition.md): hierarchy, actions, states, decided before any DOM.
3. [contexts/grammars/contract.md](../../../contexts/grammars/contract.md): what each role is in every
   grammar, then [common.md](../../../contexts/grammars/common.md) and the app's grammar file
   ([core.md](../../../contexts/grammars/core.md) or [offset-pop.md](../../../contexts/grammars/offset-pop.md)).
4. [contexts/ui/components/](../../../contexts/ui/components/README.md)`<role>.md` for each role the page uses:
   when to pick it against its neighbours, variants, sizes, states.
5. [contexts/ui/scale.md](../../../contexts/ui/scale.md) for every size step, then
   [presentation.md](../../../contexts/ui/presentation.md) for gaps, type rank and room on app boundaries.

An auditor reads [proof.md](../../../contexts/ui/proof.md) and its thresholds instead. Product records
(brand direction, accepted archetypes, acceptance assertions) live in the app's `.starciwork/`.

## The app writes layout only

- Set gap, inset, measure and overflow between components on boundaries the app owns, on the grammar's
  spacing scale.
- Pick `Text` and `Heading` rank and tone by information rank, and a component's closed props.
- Never write a colour, a px length or an arbitrary value; never paint, pad or retype inside a grammar
  component; never reach into one with a selector or a passed class; never rebuild what a component owns.
- Glyphs go through the grammar's `Icon`; the app picks the meaning, never the glyph set or size.

## Lint proves it

The app's ESLint config carries `@starci/eslint-canon-fe` and the grammar's `@starci/eslint-grammar-<id>`;
the knowledge cites their rule ids (`starci-fe/*`, `starci-grammar/*`). Run the scoped check; a finding is
fixed in the code, never suppressed or excepted:

```text
starci check run
starci check loosening
```

In a contract this is the `check-run-green` preset, which the `code` label carries by default. Taste
and UX are the owner's review after the checks, never a contract check.
