---
slots: [be.feature.saga, be.feature.saga.steps, be.feature.saga.compensations]
---
# Sagas

A saga is a flow with a declared undo: optional, pressed by a person, run as an ordinary forward step. The default is a chain of
jobs that moves forward only (BE-JOBS-7, BE-RESILIENCE-2); a flow becomes a saga only when it declares such an undo. This file
decides how that flow is written when it spans contexts or services: a saga feature folder whose orchestrator lists the steps and
the optional compensations a person may press, a versioned and fenced run state in `platform/saga`, consumers that advance it
through the inbox, and events declared in the vendored contracts. A saga folder is legal only when `sides.be.patterns`
declares `saga`. Its events travel on the event bus and its state table is a migration.

## BE-SAGA-1 A declared undo is a compensation beside its step, pressed by a person and run forward
`features/saga/<saga>/` holds `<saga>.saga.service.ts`, `steps/<step>.saga-step.ts` and, for a step that declares an undo,
`compensations/<step>.compensation.ts`: a compensation has the step of the same name, a step needs no compensation, and the
orchestrator passes every step and every compensation of its folder to `platform/saga`, each compensation as an object naming the
step it undoes. A compensation is optional. A person presses it, and it runs as an ordinary forward step of the flow: a job of its
own on the job runner's ladder, with its own row, effects and dead letter; no machine runs it because a later step failed. It
undoes every effect of its step, including those another service made.

Why: a flow moves forward only, and a failure leaves a typed failed or stopped row a person sees; when the business can undo a step,
the undo is a declared, reviewable act a person decides to make, not a reflex that can itself fail half-way. Pairing by file name
makes an undo with no step a finding, and listing both keeps an unrun step from hiding.

Enforced by: R01 HFS_SLOT_UNDECLARED.

## BE-SAGA-2 The state of a run is typed, versioned and moved only through the fenced store
`<saga>.saga-state.ts` exports the state type with `status` and `version: number`. The orchestrator is thin; `platform/saga` owns the
run: a transition names the version it read and moves it by one, after taking its event through the inbox. A saga consumer passes
the delivery's `eventId` to its command. A failing step or compensation lets its failure reach the runner, which retries a transient
one on its ladder and parks any other with one item until a resume (BE-JOBS-7), except a step declared non-blocking (BE-SAGA-5); the resumed delivery replays through the inbox and the
version fence, so a step already done is not repeated.

Why: deliveries repeat and arrive late; the version fence stops a late delivery from moving a run twice, and the inbox makes a
redelivery a no-op.

Enforced by: R80 BE_INBOX_DEDUPE_MISSING, R203 BE_FEATURE_THIN.

## BE-SAGA-3 Every event of a step or compensation is in a vendored contract
A step and a compensation each declare `readonly event = "<name>"`; both events exist in a vendored `be/contracts/<service>/events.json`,
and the compensation's event declares `compensates: "<event of the step>"`. A consumer lists what it reads in its app's `consumes.ts`
(BE-SERVICES-3).

Why: the failure event is the only thing that tells the saga to undo a step; declaring the pairing in the contract makes it
reviewable in the provider and judged in the consumer.

Enforced by: R166 HFS_EVENT_CONTRACT.

## BE-SAGA-4 Every compensation path has a spec that injects a failure
For each compensation an e2e spec boots the real apps through `useTestWorld`, names the compensation's event, injects a failure
through the world (an infra or app outage or latency, a fake's `failNext`, an interrupted database) at the moment the compensation
runs, and reads the compensated state back; one more spec runs the saga from the api call to its final state, in integration specs.

Why: a compensation undoes what a person decides to undo; a happy-flow spec proves nothing about it, and a fault injected at delivery
proves retry and resume.

Enforced by: R167 BE_ASYNC_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.

## BE-SAGA-5 A side step does not block the run
A step that only informs (an owner notice posted into team chat, a report, analytics, an echo of the message) is declared non-blocking
in the run definition, beside the step, and sits on a branch the flow does not wait for. When it fails, the runner records the failure
on the run and raises one item (BE-JOBS-7), then continues to the next step; the run is never parked for it, and a transient
failure of it is retried on its own job. The step that answers the customer, and every step it needs, is never ordered after a side
step. A step that changes state another step reads, or whose failure the outcome depends on, is not a side step and stays blocking.

Why: BE-SAGA-2 parks a run on any failure that is not transient, which is right for a step the outcome depends on and wrong for a
notice: a step that posts an owner notice and fails on a migration the database has not applied would park the whole run and leave a
customer with no reply until a resume. Declaring what only informs keeps the customer path independent of the side paths.

Enforced by: R390 BE_SAGA_SIDE_STEP_BLOCKING (candidate: planned, no checker yet; held by review until the step declaration carries a
`blocking` field a checker can read).

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

## BE-SAGA-7 A run a customer waits on is on the waited ladder
A run whose trigger is a customer message declares the `waited` ladder (minutes, such as 1, 2, 4 and 8, as the app's ladder policy
declares them; BE-JOBS-7) in the declaration of its
jobs, and every other run declares `background`. After the last rung the run is a dead letter with its one item for a person's
"resume now", and a new build hands it back at once. Each resume replays through the inbox and the version fence, so a step already
done is not repeated.

Why: a customer waits minutes, and most causes of a park (a migration applied a minute later, a provider back after a blip) are gone
within the first rungs; a ladder declared once per class of flow keeps that cadence out of every flow's own code, and bounding it
keeps a run that cannot succeed from retrying forever.

Enforced by: R392 BE_SAGA_INTERACTIVE_RESUME_LADDER (candidate: planned, no checker yet; held by review; the ladder name is a typed
member of every job declaration, so a job without one does not compile).
