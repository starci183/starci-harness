# Patterns

How app code is written: [shared](shared/README.md) holds the rules both sides follow, [be](be/README.md) (NestJS) and
[fe](fe/README.md) (Next.js) the rules of one side.

Every rule of this tree has one form: a heading that opens with its stable id and states the law in one sentence
(`## SHARED-TYPING-2 ...`, `## FE-FUNCTION-2 ...`, `## BE-PERSISTENCE-5 ...`), the body that makes it concrete, a
`Why:` line and an `Enforced by:` line naming the enforcer (a lint rule id with the HFS rule of
[hfs/rules.yaml](../hfs/rules.yaml) it belongs to, a gate, or "review only"). A rule cites the HFS rule instead of
restating what it flags, and cites another rule's id instead of restating its law. The heading id is what a task's
`rulesApplied` cites and what `starci contexts search` marks citable.

A side topic's front matter lists the slots it teaches (`slots`; `files` for scaffolded trees in be), which is how an
agent and the anatomy generator map a slot to its topics. Shared topics apply to every slot and carry none. A fact
both sides hold in the same words lives once in `shared/`; how a rule changes is the house rules of
[contexts/README.md](../README.md#house-rules-for-editing-contexts).

## Read for a coding task

An op that writes code or tests reads, in this order, and cites the rule ids it applied:

1. **The project map:** [project/README.md](../project/README.md), [anatomy.md](../project/anatomy.md) (where the
   slot's code lives), [lint.md](../project/lint.md) (what machines judge), and the edition file
   ([lite.md](../project/lite.md) or [full.md](../project/full.md)).
2. **Shared:** [shared/README.md](shared/README.md) and every topic it lists.
3. **The side:** [be/README.md](be/README.md) or [fe/README.md](fe/README.md); a front-end screen also reads the ui and
   grammar files of the [knowledge reading order](../README.md#reading-order-by-task).
4. **The slot topics:** the side topics whose front matter `slots` names a slot the task touches (the anatomy prints
   each slot's topics), and the topics those cite.
5. **The lint of the rules cited:** for each `R<n>` a rule names, its entry in [hfs/rules.yaml](../hfs/rules.yaml) and
   the documentation of its enforcer: the front-end canon's `packages/eslint-canon-fe/docs/<law>.md`, the back-end
   canon's rule source header in `packages/eslint-canon-be/<law>.mjs`, and the grammar lint for a grammar call.

Steps 1 to 3 are each op label's `context.base`; steps 4 and 5 depend on the slots and are the task's
`context.extend`, which the Kernel writes from the anatomy.

## Review obligations

What a reviewer judges in app code that no rule decides: the machine-decidable part of each concern (tier direction,
composition, public surface, data boundary, configuration) is a rule of [hfs/rules.yaml](../hfs/rules.yaml) and its
topic, and a review never re-judges it or waives a missing check. A review finding cites the obligation's id. Each is
held by review.

### CODE-REVIEW-1 Every capability, state and contract has one accountable owner

A consumer reads the owner's capability, state or contract; it never copies its policy or keeps a second authority for
its state. Why: a change and its repair need one place to land, even when there is only one consumer today.

### CODE-REVIEW-2 An abstraction carries a responsibility

A wrapper, interface, base class, module or package exists for a contract, policy, lifecycle or coordination it owns;
a forwarding layer that adds none is removed. A file count or an older example is no reason for a layer. Why: an empty
layer hides the owner it pretends to establish.

### CODE-REVIEW-3 State names its authority and its lifecycle

A stateful component says which source is authoritative, who updates it, the identity scope it is keyed by, when it
expires and how it recovers; a cache or read model says how it stays in step and what lag a reader sees, and never
becomes a second truth. Scopes with different identity or lifetime (tenant, workspace, request) are never collapsed
into one cached value or long-lived instance. Why: correctness lives in transitions and recovery, not in the static
shape the lint sees.

### CODE-REVIEW-4 Authority holds at every entry point

The resource check of BE-AUTH-2 is reached from every door, job and service call that acts on the resource, and a
caller-supplied scope is never treated as permission. Why: authority must survive a new entry point, which a decorator
or import check cannot show.

### CODE-REVIEW-5 Every effect has its failure and recovery contract

A mutation or external effect states its atomicity, identity, deadline, failure and retry or recovery, through the
mechanism [BE-MECHANISM-1](be/README.md#be-mechanism-1-choosing-a-mechanism-the-smallest-one-the-invariant-needs)
chose; invariants under competing writers are BE-FUNCTION-6. An unknown remote outcome stays unknown until it is
reconciled, and a local acknowledgement or fence is no proof of what the remote side did. Why: a crash or a lost
acknowledgement separates the effect from its record.

### CODE-REVIEW-6 A runnable component exposes its lifecycle

Startup, shutdown, dependency classes (required, degraded, optional, by behaviour rather than vendor) and redacted
failure evidence are defined, and liveness, readiness and a functional check stay separate signals (BE-AUTH-8).
Configuration is parsed and validated before the first listener, migration, consumer or outbound call (BE-CONFIG-1,
BE-CONFIG-2). Why: a live process may still be unable to serve its declared work.

### CODE-REVIEW-7 Evidence matches the claim

A claim of concurrency, crash, authorization or recovery behaviour is proved at the boundary it names, on the real
store, broker or provider; a unit double proves control flow only, and a static pass or a live process proves nothing
beyond what it measured. Why: a green check means only what it actually ran.