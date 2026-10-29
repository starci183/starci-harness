# Loosening

What makes a check pass without the code satisfying it. The banned markers are selected in
[policy/loosening.yaml](../../../policy/loosening.yaml) and detected by the harness (`cli/src/core/check/markers.ts`);
this topic says what an author does instead.

## SHARED-LOOSENING-1 No inline suppression, escape marker or swallowed failure

Source, specs, scripts and configs hold none of: `eslint-disable` in any form or an inline ESLint config comment,
`stylelint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, a coverage ignore (`istanbul`, `c8`, `v8`), a
Sonar no-sonar or `sonar-disable` comment, `prettier-ignore`, a skipped or focused test (`.skip`, `.only`, `xit`,
`fdescribe`), `|| true` on a command, `--no-verify`, TLS verification turned off (`NODE_TLS_REJECT_UNAUTHORIZED` set to 0
in code, a script, a workflow, a Dockerfile or an env template, a client's `rejectUnauthorized: false`), or a widened
allowlist, baseline or exclusion. An empty `catch` is a swallowed failure too: handle the error, return a typed
outcome or rethrow.

Why: an inline switch turns a rule into a convention that holds only where nobody wrote the comment; with no exit in
the file, the only fixes left are the code and the rule.

```ts
try {
    return { items: await this.list(workspaceId), ready: true }
} catch (error) {
    if (isMissingTable(error)) return { items: [], ready: false }
    throw error
}
```

Enforced by: the `loosening` gate over the whole tree; R18 HFS_INLINE_SUPPRESSION (`no-inline-suppression`,
`no-inline-lint-config`, and `noInlineConfig` in both canons' linter options); R303 HFS_BYPASS_MARKER; for the
empty `catch`, the back-end `catch-must-account` (R40, BE-ERROR-4) and the front-end `no-empty-catch` (R65).

## SHARED-LOOSENING-2 A wrong rule is changed in its owner, never around it

When a canon rule, the grammar or the harness refuses correct code, the fix is a change to that package, made by its
own task. A coding op reports it (`blocked`, naming the package, the rule and the finding) and never adds a local rule,
an override, a shim or an exception to make its checks green. The only exception mechanism is an entry of the
repository's `policy/loosening.yaml`, pinned to the exact lines of a fixture, template or detector file, or of a file a
live owner ruling covers (its header says the form), which an owner decision adds.

Why: a local workaround forks the standard silently, and the next app repeats the same fight.

Enforced by: R16 HFS_TOOL_CONFIG_LOCAL, R17 HFS_RULE_OFF_WITHOUT_REPLACEMENT, R103 HFS_REPO_LOCAL_CHECK; the
`loosening` gate reports a pinned line that matches no finding (`EXCEPTION_STALE`) and refuses an exception on any other
file (`EXCEPTION_KIND_REFUSED`) or one citing no live ruling (`EXCEPTION_RULING_UNKNOWN`).
