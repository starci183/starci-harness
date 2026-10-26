---
slots: []
---
# Comments

What a front-end comment says beyond the shared law. The export docblock, line comments that say why, English source
and the ban on suppressions are [shared comment](../shared/comment.md) SHARED-COMMENT-1..3 and
[shared loosening](../shared/loosening.md) SHARED-LOOSENING-1.

## FE-COMMENT-1 Document the constraint a name cannot carry, and nothing else

A props field, an `on` action or a hook parameter carries a `/** */` line only when its name hides a constraint (`/** The
public identifier the route carries, not a UUID. */`, `/** Fake data of the same shape: the skeleton reuses the ready
tree. */`); a hook's or a key's docblock states the decision it encodes and the alternative it rejects (`/** The workspace
is part of the key, so two workspaces never share a cached list. */`); no comment holds copy, which lives in the
catalogs.

Why: a comment on every field trains readers to skip comments, and cache keys and selection sets encode decisions a
later reader cannot rediscover.

Enforced by: review only.
