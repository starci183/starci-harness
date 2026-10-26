# Comment

Whether a declaration or statement carries a comment and what it says. What each side documents beyond exports
(back-end members, enum members, decorator placement, comment casing; front-end fields, hooks and documents) is the
side's comment topic.

## SHARED-COMMENT-1 Every export carries a docblock that states responsibility

Every exported declaration has a `/** */` docblock directly above it. Its first sentence says what the declaration
owns, promises or refuses (who calls it, what must not happen, why a value can be absent), never its name in other
words.

Why: the docblock is what an editor shows at every call site, and a restated name hides the missing reason.

```ts
/** Cache identity of the workbench read; the workspace id is part of every key. */
export const QUERY_WORKBENCH_SWR_KEY = "QUERY_WORKBENCH_SWR"

/** The only owner of the adjustments table; a correction and its evidence line commit together. */
export class AdjustmentsService {
```

Enforced by: `require-export-jsdoc` in both canons (R89 BE_SOURCE_FORM, R91 FE_SOURCE_FORM); the back end also
refuses a restated name (`no-restated-name-jsdoc`); whether the sentence says something the name does not is review.

## SHARED-COMMENT-2 A line comment sits above its statement and says why

A `//` comment stands on its own line above the code it explains and states the reason or the consequence; it never
narrates what the next line does. Code that needs no reason carries no comment.

Why: the code already says what it does; the reason is the one thing a later reader cannot recover from it.

```ts
// idempotent add, because a second row would violate the unique key on (order, sku)
await manager.query(UPSERT_ORDER_LINE, [orderId, sku, quantity])
```

Enforced by: back end R89 (placement and form); front end review only.

## SHARED-COMMENT-3 Source text is English, with no emoji

Identifiers, comments, docblocks, string literals, test titles and file names are English; text in another language
lives only in the message catalogs and i18n fixtures. No emoji or pictograph appears anywhere in source. The back end
is stricter: its source is ASCII.

Why: one language keeps every file readable by every reader and every search, and copy in source escapes translation.

Enforced by: back end `no-non-ascii-source` (R89); front end `no-vietnamese-in-source`, `no-emoji-in-source` (R91)
and `no-second-language-in-path`; R96 HFS_DOC_NOT_ENGLISH for Markdown and YAML.
