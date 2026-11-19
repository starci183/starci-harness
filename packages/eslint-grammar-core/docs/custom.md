# Custom

Law module: `custom.ts` (the rule), `lib/custom-inventory.ts` (the report), and `customContext` of `@starci/eslint-canon-fe/lib/custom.mjs` (the exemption every other rule gets).

`<Custom reason="...">` from `@starci/grammar` is the escape hatch: a region where any markup, any class name and any library may be used because no Grammar component fits. See `contexts/ui/components/custom.md`.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/custom-has-reason`

A Custom region names its reason, a non-empty string literal saying why no Grammar component fits. A spread attribute may carry it and is not judged. The rule judges the `<Custom>` element itself, so it is the one rule the region does not silence.

**Invalid** (`src/components/blocks/Runs/component.tsx`)

```ts
export const A = () => <Custom />
```

**Valid** (`src/components/blocks/Runs/component.tsx`)

```ts
export const A = () => <Custom reason="workflow graph editor"><Canvas /></Custom>
```

## The exemption (every other rule of this plugin)

Inside the subtree of a `<Custom>` element (its attributes and everything it renders) no rule of this plugin reports. A finding on an import whose every use is inside a `<Custom>`, or inside a same-file component that is not exported and that only a `<Custom>` renders, is dropped too. Outside a region every rule is judged as before. `Custom` is recognised by its import from `@starci/grammar`: an app component of the same name opens no region.

## The inventory (not a rule)

`starci-custom-inventory [root] [--json]` lists every `<Custom reason="...">` under `root` (file, position, `as`, reason, libraries). It is a report for audit and always exits 0; a region with no reason is listed as such and `custom-has-reason` is what fails it. The same report is `customInventory` and `formatCustomInventory`, exported from the package.
