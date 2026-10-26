---
slots: []
---
# Comments

Whether a declaration carries a comment and what it says: ownership and consequence, never the name.

## FE-COMMENT-1 Every export carries a docblock

Every export has a `/** */` docblock whose first line states ownership or role ("resolved by the connected owner",
"no transport lives here"), not the name. `/** Props for CartPage. */` alone says nothing.

Why: the docblock is what an editor shows at every call site.

Enforced by: R91 FE_SOURCE_FORM.

## FE-COMMENT-2 Fields only when the name is not enough

Document a handler, a source-sensitive prop, a hook param or a grammar prop when its name does not carry the
constraint (`/** The public identifier the route carries, not a UUID. */`). Self-evident fields carry nothing.

Why: a comment on every field trains readers to skip comments.

## FE-COMMENT-3 Decision prose on hooks and documents

Hooks and GraphQL documents carry docblocks whose paragraphs open with the claim and then the reason, including the
rejected alternative ("The viewer is part of the key, so two sessions never share cached state.").

Why: cache keys and selection sets encode decisions a later reader cannot rediscover.

## FE-COMMENT-4 Line comments explain a consequence

A `//` comment sits above its statement and says why or what follows from it; it never restates the code.

## FE-COMMENT-5 What a comment never holds

No second language, no emoji, no suppression (`eslint-disable`, `ts-ignore`, `ts-expect-error`), no copy (copy lives
in the catalogs, [i18n.md](i18n.md)). A rule that must differ is changed in the canon, never switched off in a file.

Why: a suppression turns a rule into a convention.

Enforced by: R18 HFS_INLINE_SUPPRESSION, R58 FE_I18N_LITERAL, R91.
