# Button variant: the one primary (CTA-6)

Owner: contexts/ui/composition/cta.yaml

A Grammar `Button` and `IconButton` have three looks, one prop: `variant` is `primary` (solid, the one main action of a card or region), `border` (the default: an outline, every secondary action) or `danger` (a destructive action). There is no intent, step, ghost, tertiary, secondary or soft-danger look (Grammar 0.55.0). These laws apply to every Grammar family in both app editions; aliases and namespace imports retain the same obligations.

| Rule | Finding code | Required behavior |
| --- | --- | --- |
| `starci-fe/single-commit-per-render` | `FE_SINGLE_COMMIT_PER_RENDER` | Render at most one `variant="primary"` per component path. Different return paths, opposite conditional arms and opposite guards are mutually exclusive. |
| `starci-fe/no-commit-in-collection-item` | `FE_NO_COMMIT_IN_COLLECTION_ITEM` | An item's command is `border` (the default). A `.map` callback or explicit Grammar collection item context cannot expose a primary. |

```tsx
<AlertDialog>
  <Button>Cancel</Button>
  <Button variant="danger">Delete record</Button>
</AlertDialog>
```

`starci app codemod v0550` moves an app onto the three looks: commit is `primary`; neutral, alternative, dismiss, retry, ghost, tertiary, secondary and outline are `border`; destructive, danger and danger-soft are `danger`. A dynamic value is left marked `TODO(button)`.
