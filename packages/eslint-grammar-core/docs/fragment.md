# Fragment

Law module: `fragment.ts` (the rule), `lib/fragment-inventory.ts` (the report), and `fragmentContext` of `@starci/eslint-canon-fe/lib/fragment.mjs` (the exemption every other rule gets).

`<Fragment reason="...">` from `@starci/grammar` is the escape hatch: a region where any markup, any class name and any library may be used because no Grammar component fits. See `contexts/ui/components/fragment.md`.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/fragment-has-reason`

A Fragment region names its reason, a non-empty string literal saying why no Grammar component fits. A spread attribute may carry it and is not judged. The rule judges the `<Fragment>` element itself, so it is the one rule the region does not silence.

**Invalid** (`src/components/blocks/Runs/component.tsx`)

```ts
export const A = () => <Fragment />
```

**Valid** (`src/components/blocks/Runs/component.tsx`)

```ts
export const A = () => <Fragment reason="workflow graph editor"><Canvas /></Fragment>
```

## The exemption (every other rule of this plugin)

Inside the subtree of a `<Fragment>` element (its `reason` attribute and everything it renders) no rule of this plugin reports. A finding on an import whose every use is inside a `<Fragment>`, or inside a same-file component that is not exported and that only a `<Fragment>` renders, is dropped too. Outside a region every rule is judged as before. `Fragment` is recognised by its import from `@starci/grammar`, followed through the local alias (`import { Fragment as GrammarFragment }`, the way a file that also needs React's Fragment writes it): React's Fragment, `<>` and an app component of the same name open no region.

## The inventory (not a rule)

`node node_modules/@starci/eslint-grammar-core/dist/lib/fragment-inventory-cli.js [root] [--json]` lists every `<Fragment reason="...">` under `root` (file, position, reason, libraries). It is a report for audit and always exits 0; a region with no reason is listed as such and `fragment-has-reason` is what fails it. The same report is `fragmentInventory` and `formatFragmentInventory`, exported from the package.
