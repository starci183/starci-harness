# Icons are outline only

Law module: `outline-icons.ts`. Finding code: `FE_OUTLINE_ICONS_ONLY`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#ICONS-OUTLINE`.

Never a filled or solid icon. An icon that stands alone as the mark of a row, a card, an empty state or a graph step sits in an icon tile (a soft-tone square holding an outline icon); an icon inline with text (a status beside a label, a search field, a button start icon, a link arrow, meta) is a plain outline icon at text size with no tile; a status is a tone-coloured outline icon with no tile.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/outline-icons-only`

- An import, re-export, dynamic import or `require` of `@heroicons/react/16/solid`, `/20/solid`, `/24/solid` (or `@starci/heroicons/<size>/solid`), in any source file (message `solid`).

**Invalid**

```tsx
import { CheckIcon } from "@heroicons/react/16/solid"
```

**Valid**

```tsx
import { CheckCircleIcon } from "@heroicons/react/24/outline"
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
