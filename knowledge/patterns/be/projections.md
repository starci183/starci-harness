---
slots: [be.projections]
---
# Projections (read models)

Decides where a read that needs another context's data comes from: never a cross-context join, but a read model on the reading
context's connection, recomputed from source events. That nothing crosses a context is BE-PERSISTENCE-11. In lite the table is a
migration with a rows type instead of an entity; behaviour is unchanged.

Edition: written from the full edition; the lite reference app declares none of these patterns, and whether lite
admits them is open ([project/lite.md](../../project/lite.md) "Patterns").

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
