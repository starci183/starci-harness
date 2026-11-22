# Site type role

Law module: `site-type-role.ts`. Finding code: `FE_SITE_TYPE_ROLE`. Knowledge: `runtime/knowledge/ui/presentation/grammar-laws.yaml#SITE-TYPE-ROLES`.

Grammar 0.55.0 adds the site group, five type roles for the public marketing site: `display.hero`, `display.section`, `display.figure`, `lead` and `title.card` ([presentation](../../../contexts/ui/presentation.md) "The site group"). The owner approved the group for the public site only, never the console: "3. THÊM NHÓM".

## `starci-grammar/site-type-role`

Outside the public site, in product source, it reports:

- `<Text role="display.hero">`, and the other four roles of the group, with a literal role;
- the public class of one of them in a class string: `starci-type-display-hero`, `starci-type-display-section`, `starci-type-display-figure`, `starci-type-lead`, `starci-type-title-card`.

**The site.** No hfs slot marks the public site yet. The proposed slot is `fe.site`, and a file it owns counts as the site from the day it exists. Until then the rule reads the slots the manifest already has, through `classify`:

- an owner of `fe.components` or `fe.feature` named `Site…` or `Marketing…` (`SiteHead`, `SiteBrandPage`);
- a route file of `fe.route` under the `(site)` or `(marketing)` route group;
- a capability of `fe.modules` named `site…` or `marketing…` (`modules/site-home`).

It runs at error. It is not a counting rule, because no console uses the group.

**Invalid** (in `components/blocks/Overview/component.tsx`)

```tsx
<Text role="display.hero">{title}</Text>
<h3 className="starci-type-title-card">{name}</h3>
```

**Valid** (in `components/composites/SiteHead/classNames.ts`, and the ten roles anywhere)

```tsx
export const DISPLAY = "starci-type-display-hero mt-5 text-balance"
<Text role="title.page">{title}</Text>
```
