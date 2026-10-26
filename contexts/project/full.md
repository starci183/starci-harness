# Full: what differs

Only the differences of a full app from the shared project model ([README.md](README.md)); everything not named here
is the same in both editions. An `hfs.json` without an edition is full (R212 in [hfs/rules.yaml](../hfs/rules.yaml)).
Each line names the owner of the fact; the slot, rule or ruling is the authority, not this page.

## Shape of production

- Several services, each its own Nest app at `be/apps/<service>` with its own image and a `role: service` component
  in the application stacks, running on the app's own infrastructure. Owners: ruling `R212/case-10` in
  [decisions/rulings.yaml](../decisions/rulings.yaml); BE-SERVICES-1 to 4 in
  [code/be/services.md](../code/be/services.md); R163 to R165.

## Backing services

- The project runs its own Postgres; TypeORM migrations are the schema authority. Owners: slot `be.persistence` in
  [hfs/slots.yaml](../hfs/slots.yaml); [code/be/persistence.md](../code/be/persistence.md) BE-PERSISTENCE-1.
- Redis and Qdrant are declarable backing services. Owner: `ruleParams.be.backing` in [hfs/slots.yaml](../hfs/slots.yaml);
  ruling `lite-vector-is-pgvector`.
- The event bus is Kafka with a transactional outbox. Owners: slot `be.platform.event-bus`; ruling
  `be-bounded-contexts`; [code/be/event-bus.md](../code/be/event-bus.md).
- Identity is the project's own identity provider (Keycloak in the full stack verbs). Owners:
  [README.md](../../README.md) (verb groups; `starci explain` lists what is built); [code/be/api-auth.md](../code/be/api-auth.md) BE-AUTH-2.
- Supabase is used only through a declared connection. Owners: slots `app.supabase*`, `be.integrations.supabase`.

## Patterns

- `app add reactor|saga|projection` are full verbs. Owner: [README.md](../../README.md) (verb groups; `starci explain` lists what is built); the patterns
  each needs are `ruleParams.be.kindPatterns` and `addKinds` in [hfs/slots.yaml](../hfs/slots.yaml). Whether lite may
  also declare them is open ([lite.md](lite.md)).
- Contexts meet only through events, projections replace cross-context joins and reactors keep local copies.
  Owner: ruling `be-bounded-contexts`; [code/be/reactors.md](../code/be/reactors.md),
  [code/be/projections.md](../code/be/projections.md), [code/be/saga.md](../code/be/saga.md).
- Every component image of a multi-service stack is pinned. Owner: R164, BE-SERVICES-2.

## Infrastructure the project runs

- `.starcistacks/` may carry compose, swarm, k8s and terraform trees per environment; dev runs every dependency from
  its compose files. Owner: slot `app.starcistacks`; R10; [stacks.md](stacks.md).
- `stack up|down` start and stop the full infrastructure (broker, identity provider, test world) beside the shared
  `stack deploy|verify|rollback`. Owner: [README.md](../../README.md) (verb groups; `starci explain` lists what is built).

## Deploy targets

- Every app, front end included, ships its own image to the Swarm stack. Owners: slots `repo.app-image`,
  `app.ci-images`, `app.ci-stack-deploy`.

## What CI runs

- The e2e world boots the app's own stack from `.starcistacks/<env>` behind toxiproxy, with real migrations; every
  consumed event and saga has its e2e spec. Owners: slots `be.tests.world`, `be.tests.e2e`;
  [code/be/test.md](../code/be/test.md) BE-TEST-12; BE-SERVICES-4; R173; the `@starci/test-world` pin in
  [stack/pins.yaml](../stack/pins.yaml).
- The e2e workflow and browser journeys run. Owners: slots `app.ci-e2e`, `app.browser`, `app.browser-config`;
  the `e2e` gate of the CI tier in [policy/quality.yaml](../../policy/quality.yaml).

## Work

- `.starciwork/` keeps the whole Work tree (Business/SRS, Architecture/SDS, `features/`). Owner: slot
  `app.starciwork`; ruling `R212/case-4`.

## Read with

[README.md](README.md), [stacks.md](stacks.md), [lite.md](lite.md).
