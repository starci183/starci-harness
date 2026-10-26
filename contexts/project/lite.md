# Lite: what differs

Only the differences of a lite app from the shared project model ([README.md](README.md)); everything not named here
is the same in both editions, including the code structure, the front-end standard, the queue (BullMQ on Redis) and
the three realtime doors. The edition is fixed at scaffold in `hfs.json` (R212 in [hfs/rules.yaml](../hfs/rules.yaml)).
Each line names the owner of the fact; the slot, rule or ruling is the authority, not this page.

## Shape of production

- One stateless, horizontally scaled instance type on managed Supabase, plus one minimal instance of each declared
  backing service. Owner: ruling `R212/case-10` in [decisions/rulings.yaml](../decisions/rulings.yaml).
- Every replica serves any request; shared state lives in Postgres or the declared Redis. Owner: ruling
  `R212/case-9`, [code/be/realtime.md](../code/be/realtime.md).

## Backing services

- Postgres, Auth and Storage are Supabase: the local Supabase CLI stack in dev, hosted Supabase in production, never a
  Swarm service. Owners: slots `app.supabase*` and `be.integrations.supabase` in [hfs/slots.yaml](../hfs/slots.yaml);
  ruling `lite-production-swarm`; the `supabase` pins in [stack/pins.yaml](../stack/pins.yaml).
- Redis is the only declarable backing service (`sides.be.backing`), run durably; vectors use Supabase pgvector, so
  no Qdrant. Owners: `ruleParams.be.backing` in [hfs/slots.yaml](../hfs/slots.yaml); ruling `lite-vector-is-pgvector`;
  R276.
- No self-hosted database, broker or vector store, and no Kafka or Qdrant client. Owners: R276;
  `ruleParams.be.lite.infraOwners` in [hfs/slots.yaml](../hfs/slots.yaml).
- A sidecar keeps its own storage on a declared volume. Owner: R276.

## Patterns

- Schema authority is Supabase migrations with generated row types, not TypeORM. Owners:
  `ruleParams.be.lite.schemaAuthority` and slot `be.persistence`; R213 to R216, R254 to R259;
  [code/be/persistence.md](../code/be/persistence.md).
- Identity is Supabase Auth: the back end verifies tokens against the project JWKS and the front end holds no
  credential. Owners: R217, R219; [code/be/api-auth.md](../code/be/api-auth.md).
- The event bus is the outbox on pgmq topics or in-process delivery, not Kafka. Owners: slot `be.platform.event-bus`;
  [code/be/event-bus.md](../code/be/event-bus.md) BE-EVENT-BUS-3.
- Jobs and projections keep their tables in Supabase migrations. Owners: slots `be.platform.jobs`, `be.projections`.
- Reactor, saga and projection: open. The pattern topics ([saga.md](../code/be/saga.md),
  [projections.md](../code/be/projections.md), [event-bus.md](../code/be/event-bus.md)) describe each one
  running in lite, while [README.md](../../README.md) (verb groups; `starci explain` lists what is built) gives `app add reactor|saga|projection` to full
  apps only. The owner's ruling decides which holds.

## Infrastructure the project runs

- `.starcistacks/` admits only the Swarm infra tree for an environment, no compose, k8s or terraform tree. Owner: the
  `lite` block of slot `app.starcistacks`; R10, R276. The local dependencies come from the Supabase CLI and the
  declared Redis.
- The lite verbs are `supabase start|stop|status|cloud`, `stack deploy|verify|rollback`, `docker build|up|down`.
  Owner: [README.md](../../README.md) (verb groups; `starci explain` lists what is built).

## Deploy targets

- The back end deploys to the Swarm stack; the database deploys through its own workflow. Owners: slots
  `app.ci-stack-deploy`, `app.ci-db`, `app.ci-images`.
- A front end may be hosted without its own image; back-end images stay required. Owner: slot `repo.app-image`.

## What CI runs

- No e2e world, no browser journeys and no e2e workflow. Owners: slots `app.ci-e2e`, `app.browser`,
  `app.browser-config`, `be.tests.e2e` (all forbidden under lite); ruling `lite-contract-specs`.
- Boot is proved by compiling the real AppModule graph with doubles, and each async pattern by its lite proof lane.
  Owners: R272, R284; [code/be/test.md](../code/be/test.md) BE-TEST-12.
- Integration specs run against the local Supabase stack without containers or toxiproxy; contract specs are
  optional. Owners: slots `be.tests.integration`, `be.tests.contract`.
- CI checks the Supabase artifacts (migrations, generated types). Owner: slot `app.ci`.
- Open: the `app` profile's CI tier in [policy/quality.yaml](../../policy/quality.yaml) lists `e2e` for every app,
  which a lite app cannot have.

## Work and custody

- `.starciwork/` admits only `.gitignore`, an optional `workspace.yaml` and brand records. Owner: ruling
  `R212/case-4`; slot `app.starciwork`.
- No secret material outside the sealed members. Owner: R220; custody itself is [stacks.md](stacks.md).

## Read with

[README.md](README.md), [stacks.md](stacks.md), [full.md](full.md).
