# Avatars in a row are one AvatarGroup

Law module: `avatar-row-uses-group.ts`. Finding code: `FE_AVATAR_ROW_USES_GROUP`. Law: `contexts/grammars/contract.yaml#DNA-COMMON-AVATAR-ROW-GROUP`.

Avatars that stand side by side, or come out of a list, are one `AvatarGroup`: it overlaps them, shows `max - 1` items and a "+N" tile, rings a broken account (`tone: "danger"`), names every member on hover (`memberNames`), and takes people (`name`, `seed`) and provider or channel marks (`mark`) alike. A hand-made row of `Avatar` has none of that and every app draws its own overflow.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/avatar-row-uses-group`

In product source, a Grammar `Avatar` with no Grammar `AvatarGroup` among its JSX ancestors in the same file that either shares its parent with another Grammar `Avatar` (message `siblings`; fragments, conditions and `&&` are looked through; reported on each one after the first) or is returned from a `.map()` callback (message `mapped`). An element passed as a JSX attribute value, a single `Avatar`, an `AvatarButton`, and Grammar's own `AvatarGroup` (not product source) are left alone.

**Invalid**

```tsx
<Stack>{providers.map((p) => <Avatar key={p.id} name={p.name} />)}</Stack>

<Stack><Avatar name="Zalo" /><Avatar name="Email" /></Stack>
```

**Valid**

```tsx
<AvatarGroup
  label="Providers"
  items={providers.map((p) => ({ id: p.id, name: p.name, mark: { icon: <p.Icon />, color: p.brand }, tone: p.broken ? "danger" : "default" }))}
  max={6}
  overflowLabel={(hidden) => t("moreProviders", { count: hidden })}
  memberNames={(names) => names.join(", ")}
/>
```

`max` is the number of slots, "+N" included: seven providers with `max={6}` show five and "+2".

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
