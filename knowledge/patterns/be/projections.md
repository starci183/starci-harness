---
slots: [be.projections]
files:
  - path: src/modules/projections/<name>/index.ts
    slot: be.projections
    template: projections/projection.index.ts.tpl
    role: Exports the projection class and its contracts, never the entity.
    rules: [BE_PROJECTION_SHAPE]
  - path: src/modules/projections/<name>/<name>.options.ts
    slot: be.projections
    template: projections/projection.options.ts.tpl
    role: The empty options of the projection (the configurable module base needs a type).
  - path: src/modules/projections/<name>/<name>.module-definition.ts
    slot: be.projections
    template: projections/projection.module-definition.ts.tpl
    role: The configurable-module base; isGlobal is the app root's decision.
  - path: src/modules/projections/<name>/<name>.module.ts
    slot: be.projections
    template: projections/projection.module.ts.tpl
  - path: src/modules/projections/<name>/<name>.projection.ts
    slot: be.projections
    template: projections/projection.projection.ts.tpl
    role: recompute* and get* only.
    rules: [BE_PROJECTION_SHAPE, BE_PROJECTION_WRITE_OWNER]
  - path: src/modules/projections/<name>/<name>.projection.spec.ts
    slot: be.projections
    template: projections/projection.projection.spec.ts.tpl
  - path: src/modules/projections/<name>/<name>.projection-entity.ts
    slot: be.projections
    template: projections/projection.entity.ts.tpl
    role: The read-model table; written only by the projection.
    rules: [BE_PROJECTION_WRITE_OWNER]
  - path: src/modules/projections/<name>/<name>.contracts.ts
    slot: be.projections
    optional: true
  - path: src/modules/projections/<name>/persistence/connection.ts
    slot: be.persistence
    template: projections/persistence.connection.ts.tpl
  - path: src/modules/projections/<name>/persistence/migrations/<epochMs13>-create-<name>.ts
    slot: be.persistence
    template: projections/migration.ts.tpl
  - path: src/features/reactors/<name>-projection/transport/message/<event>.consumer.ts
    slot: be.transport.message
    role: The reactor door that triggers a recompute.
    rules: [BE_EVENT_CONSUMER_SHAPE]
  - path: src/tests/e2e/<area>/<name>.e2e-spec.ts
    slot: be.tests.e2e
    role: "Titles projection/<scenario>: ... prove the pattern."
    spec: projection/recompute-is-idempotent, projection/replay-rebuilds
    rules: [BE_PATTERN_SPEC_MISSING]
---
# Projections (read models)

Decides where a read that needs another context's data comes from: never a cross-context join, but a read model on the reading
context's connection, recomputed from source events. That nothing crosses a context is BE-PERSISTENCE-12. In lite the table is a
migration with a rows type instead of an entity; behaviour is unchanged.

## BE-PROJECTIONS-1 Only the projection writes its table
The entity (`<name>.projection-entity.ts`) is written only by `<name>.projection.ts` of the same folder; no domain service, handler,
reactor, job or other projection writes it. Its table, migrations and registration sit in `modules/projections/<name>/persistence/`
on the connection of the context that serves the read.

Why: a read model with one writer can always be rebuilt from its sources; a second writer makes it a source of truth replay would
destroy.

Enforced by: R161 BE_PROJECTION_WRITE_OWNER, R86 BE_SQL_TABLE_OWNER.

## BE-PROJECTIONS-2 A projection speaks recompute and get, and hides its entity
Every public method is `recompute*` (an idempotent upsert by a natural key from the source facts, replayable from scratch) or `get*`
(a read). Its `index.ts` exports the class and contracts, never the entity. An api feature calls only `get*`; a reactor, job or cli
command calls `recompute*`.

Why: a closed vocabulary keeps writes replayable and reads shape-independent, and the kind rule keeps the request path off the
write side.

Enforced by: R162 BE_PROJECTION_SHAPE.

## BE-PROJECTIONS-3 A projection publishes nothing and is kept current by a reactor or a job
A projection never publishes an event or enqueues a job. A reactor under `features/reactors/<name>-projection/` consumes the source
event and dispatches a command whose handler delegates to `recompute*`; a rebuild is a job or cli command that pages the keys and
recomputes each. A projection reads its own context's facts through that context's domain services.

Why: the read model is derived data; an event from it would let derived data drive the system of record.

Enforced by: R152 BE_OUTBOX_WRITE_TX, R156 BE_KIND_ISOLATION.

## BE-PROJECTIONS-4 A declared projection is proven on the test world
An app declaring `projection` has tests titled `projection/<scenario>: ...` for each scenario of `ruleParams.be.patternScenarios`:
the same recompute twice leaves one identical row, and dropping the table and replaying the events rebuilds the same rows.

Why: idempotence and replayability are the two properties that make a read model safe to operate.

Enforced by: R155 BE_PATTERN_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.
