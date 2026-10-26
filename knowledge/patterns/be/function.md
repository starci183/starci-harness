---
slots: []
---
# Function

Decides the small forms every back-end unit follows: invariants enforced at the store, helper ownership and budgets, function
forms, and the smells the scan measures. Who executes an operation is api.md (BE-CQRS-3) and domain.md.

## BE-FUNCTION-6 Validate authority and enforce concurrent invariants at the store
Validate input, principal and resource scope before any effect. Read-before-write is an optimization, not concurrency safety:
enforce uniqueness, conditional transitions and locks at the owning store, define the conflict behaviour, and bind request
idempotency to the principal, the operation and the request (BE-IDEMPOTENCY-3). Keep local transaction completion apart from
remote acknowledgement and unknown effects.

Why: two simultaneous callers or a crash expose invariants that serial mocks cannot prove.

- When a business key must be unique → a unique index in the migration and an insert that answers the conflict as a refused
  outcome with the capability code.

Enforced by: R41 BE_DEFAULT_DENY; competing attempts against the real store are an integration spec.

## BE-FUNCTION-7 Helpers have one owner; files and functions stay within budget
A pure helper lives with its owning capability or handler; an ownerless one goes to `platform/primitives`. A helper defined twice
is a finding: delete the second and import the first. Prefer a plain function over a provider class when no lifecycle or
injection is needed. Public contracts use named params and result types; a single primitive may stay positional. File, function
and duplicate-block budgets are `hfs/slots.yaml` (`ruleParams.common.functionLines`, the slot size budgets); an over-budget file
never grows, and a long body splits by responsibility.

Why: copies drift, and a budget that ratchets keeps units reviewable.

Enforced by: R20 HFS_SIZE_GROWTH, R21 HFS_DUPLICATE_CODE, R25 HFS_UNUSED_EXPORT, R291 HFS_FUNCTION_BUDGET.

## BE-FUNCTION-9 Small function forms
An `async` function awaits something, otherwise it is not `async`. A handler and every public method of an Injectable, Resolver or
Controller declares its return type. `JSON.parse` of outside text sits inside a `try` in its own function and fails as a
capability error that keeps the cause.

Why: a declared return type keeps a contract from drifting silently, and an unguarded parse turns hostile input into a crash.

- `const parseBody = (text: string): unknown => { try { return JSON.parse(text) } catch (error) { throw new ProviderError({ code: ProviderErrorCode.BodyMalformed, cause: error }) } }`

Enforced by: R73 BE_ASYNC_NO_AWAIT, R75 BE_RETURN_TYPE, R76 BE_JSON_PARSE_UNGUARDED.

## BE-FUNCTION-10 Code clear of the smells the scan measures
Sequential steps are named, never an `await` inside a loop: `eachInOrder` of `platform/primitives` states the sequence (an endless
polling or paging loop is the one loop that keeps its `await`), and independent steps run together with `Promise.all`. A method a
base class fixes as async but that awaits nothing returns the promise it holds. The rest is refused where written: `codePointAt`
over `charCodeAt`, `String.raw` for a string that only escapes backslashes, no nested conditional expression, `void` only on a
call, no unused import, `export ... from` for a pass-through import, no deprecated API, no object turned into text.

Why: the scan measures these on every commit; a lint rule says the same thing earlier, on the line, with the fix.

Enforced by: R235 SCAN_SMELL.
