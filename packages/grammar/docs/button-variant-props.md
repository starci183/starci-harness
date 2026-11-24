# Button variant props

Source: `src/core/leaf/Button/index.tsx` (`ButtonVariant`, `ButtonLook`, `BUTTON_VENDOR_VARIANT`) and each control's exported props (0.55.0).

| Component | Prop | Values | Availability |
| --- | --- | --- | --- |
| Button | `variant` | `primary`, `border`, `danger` | Optional; default `border` |
| Button | `tone` | `accent`, `info`, `success`, `warning` | Only with `variant="primary"` |
| IconButton | `variant` | `primary`, `border`, `danger` | Optional; default `border` |
| EmptyNotice | `actionVariant` | `primary`, `border` | Optional; default `primary` |
| ItemAction (ListRow, SurfaceCard tiles) | `variant` | `primary`, `border`, `danger` | Optional; default `border` |
| AlertAction | `isDestructive` | boolean | Optional: the action draws `danger` |

The vendor mapping: `primary` is HeroUI `primary`, `border` is `outline`, `danger` is `danger`.
