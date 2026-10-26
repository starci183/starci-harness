---
slots: [be.feature.saga]
files:
  - path: src/features/saga/<saga>/index.ts
    slot: be.feature.saga
    template: saga/saga.index.ts.tpl
    role: "The public surface of the kind folder: the message module an app composes."
  - path: src/features/saga/<saga>/<saga>.options.ts
    slot: be.feature.saga
    template: saga/saga.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/saga/<saga>/<saga>.module-definition.ts
    slot: be.feature.saga
    template: saga/saga.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/saga/<saga>/<saga>.module.ts
    slot: be.feature.saga
    template: saga/saga.module.ts.tpl
    role: "The application module: handlers, orchestrator, step and compensation."
  - path: src/features/saga/<saga>/<saga>.saga.service.ts
    slot: be.feature.saga
    template: saga/saga.service.ts.tpl
    role: "The orchestrator. A `*.service.ts` because a handler injects only services; thin (R203 `BE_FEATURE_THIN`) like every feature file — it maps and delegates, and the run's orchestration lives in `platform/saga` — and it owes its `<saga>.saga.service.spec.ts` beside it (a `service` of `ruleParams.be.unitRoles`), which asserts the delegation. It hands `platform/saga` each run with the compensation OBJECT of the step (`compensation`, never a callback): the platform logs `Compensating`, orders the steps and moves the run through the version fence; its slot is `coverage: none`, so it is never a coverage target."
    suffix: saga.service
    rules: [R169, R170, R203]
  - path: src/features/saga/<saga>/<saga>.saga.service.spec.ts
    slot: be.feature.saga
    template: saga/saga.service.spec.ts.tpl
    role: "Unit spec of the orchestrator beside it."
  - path: src/features/saga/<saga>/<saga>.saga-state.ts
    slot: be.feature.saga
    template: saga/saga.state.ts.tpl
    role: "The typed state of a run, with `status` and `version: number`, the fence."
    suffix: saga-state
    rules: [R170]
  - path: src/features/saga/<saga>/steps/<step>.saga-step.ts
    slot: be.feature.saga.steps
    template: saga/saga.step.ts.tpl
    role: "One step. Names its event (`readonly event = \"<name>\"`); the domain does the work and announces the event in its transaction."
    suffix: step
    rules: [R169, R171]
  - path: src/features/saga/<saga>/compensations/<step>.compensation.ts
    slot: be.feature.saga.compensations
    template: saga/saga.compensation.ts.tpl
    role: "The compensation of the step of the same name; REQUIRED for every step. Names the step it undoes and the failure event, and dispatches one command; the orchestrator passes it to `platform/saga` as the compensation object."
    suffix: compensation
    rules: [R169, R171, R173]
  - path: src/features/saga/<saga>/application/undo-<saga>.command.ts
    slot: be.feature.application
    template: saga/saga.undo.command.ts.tpl
    role: "The undo command of the saga (command): undoes what the saga did; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/application/undo-<saga>.contracts.ts
    slot: be.feature.application
    template: saga/saga.undo.contracts.ts.tpl
    role: "The undo command of the saga (contracts): undoes what the saga did; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/application/undo-<saga>.handler.ts
    slot: be.feature.application
    template: saga/saga.undo.handler.ts.tpl
    role: "The undo command of the saga (handler): undoes what the saga did; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/application/compensate-<saga>.command.ts
    slot: be.feature.application
    template: saga/saga.compensate.command.ts.tpl
    role: "The compensate command of the saga (command): compensates a failed run; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/application/compensate-<saga>.contracts.ts
    slot: be.feature.application
    template: saga/saga.compensate.contracts.ts.tpl
    role: "The compensate command of the saga (contracts): compensates a failed run; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/application/compensate-<saga>.handler.ts
    slot: be.feature.application
    template: saga/saga.compensate.handler.ts.tpl
    role: "The compensate command of the saga (handler): compensates a failed run; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/application/complete-<saga>.command.ts
    slot: be.feature.application
    template: saga/saga.complete.command.ts.tpl
    role: "The complete command of the saga (command): completes a finished run; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/application/complete-<saga>.contracts.ts
    slot: be.feature.application
    template: saga/saga.complete.contracts.ts.tpl
    role: "The complete command of the saga (contracts): completes a finished run; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/application/complete-<saga>.handler.ts
    slot: be.feature.application
    template: saga/saga.complete.handler.ts.tpl
    role: "The complete command of the saga (handler): completes a finished run; plain CQRS (BE-CQRS-1), thin handlers calling one service."
    rules: [R87]
  - path: src/features/saga/<saga>/transport/message/<failed>.consumer.ts
    slot: be.transport.message
    template: saga/saga.failed.consumer.ts.tpl
    role: "A thin door that hands the failure delivery, with its `eventId`, to the compensate command; the saga takes it through the inbox."
    suffix: consumer
    rules: [R80, R88, R172]
  - path: src/features/saga/<saga>/transport/message/<done>.consumer.ts
    slot: be.transport.message
    template: saga/saga.done.consumer.ts.tpl
    role: "A thin door that hands the delivery of the last event, with its `eventId`, to the complete command; the saga takes it through the inbox."
    suffix: consumer
    rules: [R80, R88, R172]
  - path: src/features/saga/<saga>/transport/message/<saga>-message.options.ts
    slot: be.transport.message
    template: saga/saga.message.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/saga/<saga>/transport/message/<saga>-message.module-definition.ts
    slot: be.transport.message
    template: saga/saga.message.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/saga/<saga>/transport/message/<saga>-message.module.ts
    slot: be.transport.message
    template: saga/saga.message.module.ts.tpl
    role: "The message transport module: registers the consumers with the event bus; composed only by an app."
  - path: contracts/<service>/events.json
    slot: be.contract.events
    role: 'Every event of the saga, emitted from the publisher''s events.ts; a compensating event declares `compensates`.'
    rules: [R166, R171]
    optional: true
  - path: src/modules/platform/saga/
    slot: be.platform
    role: 'The fenced `saga_states` store and the state machine in `saga.service.ts`, which claims deliveries through the shared `platform/inbox` port (BE-IDEMPOTENCY-2). The service is a measured file of a `coverage: required` slot, held at 100 per file with its spec beside it.'
    rules: [R170, R80]
    optional: true
  - path: src/tests/e2e/<area>/<name>.e2e-spec.ts
    slot: be.tests.e2e
    suffix: e2e-spec
    role: One spec per compensation path that names the compensation event and injects a failure through the world (an infra or app outage, a fake's failNext), then reads the compensated state back; plus one spec from the api call to the final state.
    rules: [R173, R167]
    optional: true
---
# Sagas

Decides how a flow that spans contexts or services and must be undone when a later step fails is written: a saga feature folder
whose orchestrator pairs every step with its compensation, a versioned and fenced run state in `platform/saga`, consumers that
advance it through the inbox, and events declared in the vendored contracts. A saga folder is legal only when `sides.be.patterns`
declares `saga`. In lite its events travel on the lite event bus and its state table is a migration; the rules are the same.

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
