---
slots: [be.platform]
---
# The injected clock and ids

Where code reads "now" or mints an id, and how a spec drives both.

## BE-TEMPORAL-1 The Clock and Ids ports are the only ambient readers

`platform/clock` exports `Clock { now(): Date }`, `SystemClockService` (the one ambient reader) and `InjectClock()`;
`platform/ids` exports `Ids { next(): string }` and `InjectIds()`. Outside them, `Date.now`, an argument-less
`new Date()`, `performance.now`, `process.hrtime`, `Temporal.Now`, `randomUUID` and the uuid, nanoid and ulid
generators are never referenced, specs included. A service stamps `this.clock.now()` once per operation and passes it
down (or writes it as a `$n::timestamptz` parameter); `new Date(value)` from a value in hand is not ambient. Specs drive
`FakeClock` and `fakeIds()`.

Why: an ambient read cannot be replaced in a spec, so "expires after thirty minutes" cannot be driven to a chosen
instant and an id cannot be asserted exactly.

Enforced by: `no-ambient-clock` (R79), `no-ambient-id` (R142).
