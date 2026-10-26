# Control height (CONTROL-HEIGHT-1)

Owner ruling `control-height-40` (2026-10-26). One control height, 40px (HeroUI's own `h-10`), is the default of every standalone Grammar control: Button, IconButton, Input, SearchField, Select, Tabs, SegmentedControl, Switch, the chrome Avatar, Textarea and the composer send button. Grammar draws it; an app never states it.

| Rule | Finding code | Required behavior |
| --- | --- | --- |
| `starci-fe/control-height` | `FE_CONTROL_HEIGHT` | Omit `size` on a control (or pass `md`/`control`, the same 40px). `size="lg"` (48px) is only for a landing hero call to action; `xl` is never used. Controls that share one JSX row share one size, so a row never mixes `sm` with the default. `sm` (32px) is for a control nested in an item or a dense toolbar where every control of the row is `sm`. |

```tsx
<IconButton intent="dismiss" label="Notifications" source={bell} />
<Switch label="Dark mode" size="control" />
```
