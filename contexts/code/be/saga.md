---
slots: [be.feature.saga, be.feature.saga.steps, be.feature.saga.compensations]
---
# Sagas

Decides how a flow that spans contexts or services and must be undone when a later step fails is written: a saga feature folder
whose orchestrator pairs every step with its compensation, a versioned and fenced run state in `platform/saga`, consumers that
advance it through the inbox, and events declared in the vendored contracts. A saga folder is legal only when `sides.be.patterns`
declares `saga`. In lite its events travel on the lite event bus and its state table is a migration; the rules are the same.

Edition: whether lite admits this pattern is open ([project/lite.md](../../project/lite.md) "Patterns").

## BE-SAGA-1 Every step has a compensation, and the orchestrator lists them all
`features/saga/<saga>/` holds `<saga>.saga.service.ts`, `steps/<step>.saga-step.ts` and `compensations/<step>.compensation.ts`: every
step has a compensation of the same name and every compensation a step, and the orchestrator passes every compensation of its folder
to `platform/saga` as an object naming the step it undoes. A compensation undoes every effect of its step, including those another
service made.

Why: a forward step with no way back leaves a half-done flow when a later step fails; pairing by file makes the missing half a
finding, and listing both keeps an unrun step from hiding.

Enforced by: R169 BE_SAGA_STEP_COMPENSATION, R01 HFS_SLOT_UNDECLARED.

## BE-SAGA-2 The state of a run is typed, versioned and moved only through the fenced store
`<saga>.saga-state.ts` exports the state type with `status` and `version: number`. The orchestrator is thin; `platform/saga` owns the
run: a transition names the version it read and moves it by one, after taking its event through the inbox. A saga consumer passes
the delivery's `eventId` to its command. A failing step or compensation lets its failure reach the runner, which retries a transient
one and parks any other with one alert until a resume (BE-RESILIENCE-2), except a step declared non-blocking (BE-SAGA-5); the resumed delivery replays through the inbox and the
version fence, so a step already done is not repeated.

Why: deliveries repeat and arrive late; the version fence stops a late delivery from moving a run twice, and the inbox makes a
redelivery a no-op.

Enforced by: R170 BE_SAGA_STATE_VERSIONED, R172 BE_SAGA_CONSUMER_DEDUPE, R80 BE_INBOX_DEDUPE_MISSING, R203 BE_FEATURE_THIN.

## BE-SAGA-3 Every event of a step or compensation is in a vendored contract
A step and a compensation each declare `readonly event = "<name>"`; both events exist in a vendored `be/contracts/<service>/events.json`,
and the compensation's event declares `compensates: "<event of the step>"`. A consumer lists what it reads in its app's `consumes.ts`
(BE-SERVICES-3).

Why: the failure event is the only thing that tells the saga to undo a step; declaring the pairing in the contract makes it
reviewable in the provider and judged in the consumer.

Enforced by: R171 BE_SAGA_EVENT_CONTRACT, R166 HFS_EVENT_CONTRACT.

## BE-SAGA-4 Every compensation path has a spec that injects a failure
For each compensation an e2e spec boots the real apps through `useTestWorld`, names the compensation's event, injects a failure
through the world (an infra or app outage or latency, a fake's `failNext`, an interrupted database) at the moment the compensation
runs, and reads the compensated state back; one more spec runs the saga from the api call to its final state. Lite proves the same
scenarios in integration specs.

Why: the compensation exists for failures; a happy-flow spec proves nothing about it, and a fault injected at delivery proves retry
and resume.

Enforced by: R173 BE_SAGA_E2E_MISSING, R167 BE_ASYNC_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.

## BE-SAGA-5 A side step does not block the run
A step that only informs (an owner notice posted into team chat, a report, analytics, an echo of the message) is declared non-blocking
in the run definition, beside the step, and sits on a branch the flow does not wait for. When it fails, the runner records the failure
on the run and raises one alert (BE-RESILIENCE-2), then continues to the next step; the run is never parked for it, and a transient
failure of it is retried on its own job. The step that answers the customer, and every step it needs, is never ordered after a side
step. A step that changes state another step reads, or whose failure must undo earlier work, is not a side step and stays blocking
with its compensation (BE-SAGA-1).

Why: BE-SAGA-2 parks a run on any failure that is not transient, which is right for a step the outcome depends on and wrong for a
notice: on 2026-11-09 a `notify-order` step that posted an owner notice failed on a migration the dev database had not applied, parked
the whole sales run and left a customer with no reply for the 30 minutes before the resume sweep. Declaring what only informs
keeps the customer path independent of the side paths.

Enforced by: R390 BE_SAGA_SIDE_STEP_BLOCKING (candidate: planned, no checker yet; held by review until the step declaration carries a
`blocking` field the checker can read, as `rules/saga.mts` reads `event` today).

## BE-SAGA-6 A customer who got no reply gets an honest line
When a run triggered by a customer message (a chat channel, a web chat, an email reply) parks or dead-letters before the
customer received a reply, the runner sends the customer one holding line through the channel the message came from, in the locale of
the run (the customer's, else the workspace's): it says the message arrived and a person or the system will answer, and promises nothing
it cannot keep. The line is claimed in the inbox under `<runId>:holding-line` (BE-IDEMPOTENCY-1) in the transaction that records the park,
so a resume, a second park or a redelivery never sends it twice, and the send itself is a side step (BE-SAGA-5): its failure does not
change the park. A run that already replied, and a run not triggered by a customer, send none.

Why: a parked run is invisible to the customer; the alert goes to the owner, not to the person waiting. One honest line costs nothing and
turns silence into an expectation; claimed once, it cannot become spam.

Enforced by: R391 BE_SAGA_CUSTOMER_HOLDING_LINE (candidate: planned, no checker yet; held by review and by the e2e spec of BE-SAGA-4 that
parks a customer run and reads the one holding line back).

## BE-SAGA-7 An interactive run resumes on a short ladder
A parked run whose trigger is a customer message resumes on a bounded ladder declared beside the run, about 1, 5 and then 30 minutes
after the park, and at once on the first boot of a new build (`ParkedJobResumerService`, BE-RESILIENCE-2); after the last rung it stays
parked with its alert for the owner's "resume now". Each resume replays through the inbox and the version fence, so a step already done is
not repeated. A run not triggered by a customer keeps the plain sweep (`parked-jobs:sweep`, every 15 minutes).

Why: the sweep's cadence suits a batch job nobody waits for; a customer waits minutes, and most causes of a park (a migration applied a
minute later, a provider back after a blip) are gone within the first rungs. Bounding the ladder keeps a run that cannot succeed from
retrying forever.

Enforced by: R392 BE_SAGA_INTERACTIVE_RESUME_LADDER (candidate: planned, no checker yet; held by review).
