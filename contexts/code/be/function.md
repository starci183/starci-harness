---
slots: []
---
# Function

The small forms every back-end unit follows: invariants held by the store, helper ownership, budgets and the smells
the scan measures. Who executes an operation is BE-CQRS-3.

## BE-FUNCTION-6 Invariants under concurrency are held by the store

Validate the principal and the resource scope before any effect. Uniqueness, conditional transitions and claims are
enforced by the statement itself (`ON CONFLICT ... DO NOTHING`, `WHERE status = 'draft'`, `FOR UPDATE`), and the method
defines what a lost race answers (`null`, a refusal code, a retry with a new candidate). A read before a write is an
optimization, never the guard.

Why: two simultaneous callers or a retried job expose invariants that serial mocks cannot.

- When a business key must be unique → a unique index in the migration and an insert that answers no row on conflict,
  which the service turns into its next attempt or its refusal.

Enforced by: review only; races against the real store are an integration spec.

## BE-FUNCTION-7 A helper has one owner; units stay within budget

A pure decision is a `<name>.policy.ts` and a pure shape change a `<name>.mapper.ts` beside the service that uses it;
an ownerless pure helper goes to `platform/primitives`. A helper defined twice is a finding: import the first. Prefer a
plain arrow function over a provider class when nothing is injected. A function has at most
`ruleParams.common.functionLines` lines and seven parameters (an injected constructor excepted; past that, pass a
named `<Name>Params` object); a file never grows past its slot budget.

Why: copies drift, and a ratcheting budget keeps units reviewable.

Enforced by: `function-line-budget` (R291), `max-params` (R235), `file-size-growth` (R20), `duplicate-code`,
`duplicate-symbol` (R21), `dead-exports` (R25).

## BE-FUNCTION-9 Small function forms

An `async` function awaits; a method that only forwards a promise is not `async` and returns it. A handler and every
public method of a provider or door declares its return type. `JSON.parse` of outside text sits in a `try` (or a
guarded reader such as `parseJsonText` of `platform/primitives`) and fails as the owner's error with the cause.

Why: a declared return type keeps a contract from drifting silently, and an unguarded parse turns hostile input into a
crash.

Enforced by: `async-needs-await` (R73), `explicit-handler-return-type` (R75), `json-parse-needs-guard` (R76).

## BE-FUNCTION-10 Clear of the smells the scan measures

No `await` inside a loop: independent steps run with `Promise.all`, a sequence goes through `eachInOrder` of `platform/primitives`,
and an endless polling loop (`for (;;)`) is the one loop that keeps its `await`. Also `codePointAt` over
`charCodeAt`, `String.raw` for a backslash-only string, no nested conditional expression, `void` only on a call, no
unused import, `export ... from` for a pass-through import.

Why: the scan measures these on every commit; the lint says the same thing earlier, on the line.

Enforced by: `no-await-in-loop`, `prefer-code-point`, `prefer-string-raw`, `no-nested-conditional`, `no-void-operator`,
`no-unused-import`, `prefer-export-from` (R235).
