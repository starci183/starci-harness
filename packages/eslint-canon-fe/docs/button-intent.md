# Button intent (CTA-6)

Owner: contexts/ui/composition/cta.yaml

App `Button` and `IconButton` commands declare `intent`. Grammar derives their variant from that intent and its placement context. These laws apply to every Grammar family in both app editions; aliases and namespace imports retain the same obligations.

| Rule | Finding code | Required behavior |
| --- | --- | --- |
| `starci-fe/button-intent-required` | `FE_BUTTON_INTENT_REQUIRED` | Pass the command's `intent`. A known props spread may supply it. |
| `starci-fe/button-no-variant` | `FE_BUTTON_NO_VARIANT` | Omit `variant`, including variants in known props spreads. |
| `starci-fe/destructive-confirm-in-dialog` | `FE_DESTRUCTIVE_CONFIRM_IN_DIALOG` | Put `intent="destructive" step="confirm"` inside the same-file `AlertDialog` or `ConfirmDialog` content subtree. Its trigger uses `step="entry"`. A separate component's definition does not inherit its caller's JSX ancestry. |
| `starci-fe/single-commit-per-render` | `FE_SINGLE_COMMIT_PER_RENDER` | Render at most one commit per component path. Different return paths, opposite conditional arms and opposite guards are mutually exclusive. |
| `starci-fe/no-commit-in-collection-item` | `FE_NO_COMMIT_IN_COLLECTION_ITEM` | Use `alternative` for an item's next action. A `.map` callback or explicit Grammar collection item context cannot expose commit. |

```tsx
<AlertDialog>
  <Button intent="dismiss">Cancel</Button>
  <Button intent="destructive" step="confirm">Delete record</Button>
</AlertDialog>
```

`starci app codemod button-intent` defaults to a dry run. Use `--execute` to apply deterministic mappings, then resolve every case in its JSON and Markdown report from the command's actual consequence. A destructive-looking label is a review signal rather than authority to choose an intent.
