---
slots: [be.feature.saga, be.feature.saga.steps, be.feature.saga.compensations]
---
# Sagas

Decides how a flow that spans contexts or services and must be undone when a later step fails is written: a saga feature folder
whose orchestrator pairs every step with its compensation, a versioned and fenced run state in `platform/saga`, consumers that
advance it through the inbox, and events declared in the vendored contracts. A saga folder is legal only when `sides.be.patterns`
declares `saga`. In lite its events travel on the lite event bus and its state table is a migration; the rules are the same.

Edition: written from the full edition; the lite reference app declares none of these patterns, and whether lite
admits them is open ([project/lite.md](../../project/lite.md) "Patterns").

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
the delivery's `eventId` to its command. A failing compensation gives the event back so the redelivery resumes the run.

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
