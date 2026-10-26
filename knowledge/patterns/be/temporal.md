---
slots: [be.platform]
---
# The injected clock

Decides where code reads "now" and how a spec drives it: business code asks the injected `Clock` port, and only `platform/clock`
reads the ambient clock. Random ids follow the same rule through the `Ids` port of `platform/ids` (R142).

## BE-TEMPORAL-1 The Clock port is the only reader of the ambient clock
`platform/clock` exports `Clock { now(): Date }`, `SystemClock` (the only ambient reader), `InjectClock()` and the app timezone
constant. Outside it, ambient time sources are neither called nor referenced (`Date.now`, a zero-argument `new Date()`,
`performance.now`, `process.hrtime`, `Temporal.Now`); date libraries and timers stay with their owners in `ruleParams.be.infraOwners`,
and date arithmetic helpers live in `platform/primitives`. Everything else takes `@InjectClock() private readonly clock: Clock`; the
domain service stamps `clock.now()` once per operation and passes it down. `new Date(value)` from a value already in hand is not an
ambient read. Specs follow the same rule and drive `FakeClock` (`clock.advance(ms)`) instead of sleeping.

Why: an ambient read cannot be replaced in a spec, so the test sleeps or races the wall clock and an "expires after N minutes" rule
cannot be driven to a chosen instant; one injected port makes time an ordinary, fakeable dependency.

Enforced by: R79 BE_AMBIENT_CLOCK, R90 BE_INFRA_OWNER.
