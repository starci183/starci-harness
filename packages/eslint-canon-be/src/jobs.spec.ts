/**
 * Twin tests for the fenced-job laws (R157 `BE_JOB_WRITE_OUTSIDE_OWNER`, R158 `BE_JOB_FENCE_REQUIRED`, R159 `BE_JOB_EFFECT_PIECE`,
 * R160 `BE_JOB_SHAPE`, R403 `BE_JOB_NEXT_DECLARED`, R404 `BE_JOB_PROGRESS_SHAPE`).
 *
 *   node --test src/jobs.spec.ts
 *
 * The fixture project declares `JobClaims`, `JobStep`, `defineJob`, `JobProgress`, `FencedProcessor` and the job entity under
 * `platform/jobs`, `Effects` under `platform/effects`, a search queue's jobs under `queues/search` and a mail gateway under
 * `integrations/mailer`; a case's path decides its slot and tier.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { at, BE_DECLARATION, typedTester } from "../fixtures/typed/tester.ts"
import { jobEffectPiece, jobFenceRequired, jobNextDeclared, jobProgressShape, jobShape, jobWriteOwner, rules } from "./jobs.ts"

const tester = typedTester({ declaration: { ...BE_DECLARATION, patterns: ["fenced-job", "queue", "realtime"] } })

const OWNER = at("src/modules/platform/jobs/job-claim.service.ts")
const OWNER_PORT = at("src/modules/platform/jobs/jobs.claims.ts")
const DOMAIN = at("src/modules/domain/order/placing.service.ts")
const HANDLER = at("src/features/checkout/application/place-order.handler.ts")
const STEP = at("src/features/jobs/send/steps/mail.step.ts")
const PROCESSOR = at("src/features/jobs/send/transport/queue/send.processor.ts")
const WORLD = at("src/tests/world/use-test-world.ts")

test("every rule this law declares is exported under its published name", () => {
    for (const [name, rule] of Object.entries(rules)) assert.ok(rule && rule.meta && rule.create, `${name} is not a rule`)
})

const ENTITY = `import type { EntityManager } from "typeorm"
import { JobEntity } from "@modules/platform/jobs/persistence/entities/job.entity"
`

test("job-write-owner: the job row is written only by platform/jobs", () => {
    assert.doesNotThrow(() => {
        tester.run("job-write-owner", jobWriteOwner, {
            valid: [
                { filename: OWNER, code: `${ENTITY}export const claim = (manager: EntityManager) => manager.update(JobEntity, { id: "a" }, { status: "x" })` },
                { filename: OWNER, code: `${ENTITY}export const bump = (manager: EntityManager) => manager.increment(JobEntity, { id: "a" }, "fencingToken", 1)` },
                { filename: DOMAIN, code: `${ENTITY}export const read = (manager: EntityManager) => manager.find(JobEntity, {})` },
                { filename: DOMAIN, code: `import type { EntityManager } from "typeorm"\nimport { OrderEntity } from "./persistence/entities/order.entity"\nexport const w = (manager: EntityManager) => manager.update(OrderEntity, { id: "a" }, { status: "x" })` },
                { filename: DOMAIN, code: `${ENTITY}export const count = (manager: EntityManager) => manager.createQueryBuilder().select().from(JobEntity).where({}).execute()` },
                { filename: WORLD, code: `${ENTITY}export const seed = (manager: EntityManager, job: JobEntity) => manager.save(job)` },
            ],
            invalid: [
                { filename: DOMAIN, code: `${ENTITY}export const w = (manager: EntityManager) => manager.update(JobEntity, { id: "a" }, { status: "done" })`, errors: [{ messageId: "foreign" }] },
                { filename: DOMAIN, code: `${ENTITY}export const w = (manager: EntityManager) => manager.increment(JobEntity, { id: "a" }, "fencingToken", 1)`, errors: [{ messageId: "foreign" }] },
                { filename: HANDLER, code: `${ENTITY}export const w = (manager: EntityManager, job: JobEntity) => manager.save(job)`, errors: [{ messageId: "foreign" }] },
                { filename: STEP, code: `${ENTITY}export const w = (manager: EntityManager) => manager.delete(JobEntity, { id: "a" })`, errors: [{ messageId: "foreign" }] },
                { filename: DOMAIN, code: `${ENTITY}export const w = (manager: EntityManager) => manager.createQueryBuilder().update(JobEntity).set({ status: "x" }).where({}).execute()`, errors: [{ messageId: "foreign" }] },
                { filename: DOMAIN, code: `${ENTITY}export const w = (manager: EntityManager) => manager.createQueryBuilder().delete().from(JobEntity).execute()`, errors: [{ messageId: "foreign" }] },
            ],
        })
    })
})

const CLAIMS = `import type { ClaimedJob, GuardedWrite, JobClaims } from "@modules/platform/jobs"
`

test("job-fence-required: every guarded write requires its token, never casts around it and is never swallowed", () => {
    assert.doesNotThrow(() => {
        tester.run("job-fence-required", jobFenceRequired, {
            valid: [
                { filename: OWNER_PORT, code: `import type { EntityManager } from "typeorm"\nimport type { ClaimedJob, GuardedWrite } from "./jobs.contracts"\nexport interface JobClaims {\n advance(write: GuardedWrite & { step: string }): Promise<void>\n complete(write: GuardedWrite): Promise<void>\n claim(params: { kind: string }): Promise<ClaimedJob | null>\n enqueue(tx: EntityManager, params: { kind: string }): Promise<string>\n runKey(job: ClaimedJob, step: string): string\n}` },
                { filename: STEP, code: `${CLAIMS}export const run = (claims: JobClaims, job: ClaimedJob) => claims.advance({ jobId: job.jobId, expectedFencingToken: job.fencingToken, step: "a" })` },
                { filename: STEP, code: `${CLAIMS}export const run = async (claims: JobClaims, write: GuardedWrite) => { try { await claims.complete(write) } catch (error) { throw error } }` },
                { filename: STEP, code: `export const run = async (work: () => Promise<void>) => { try { await work() } catch { return } }` },
                { filename: OWNER, code: `${CLAIMS}export const run = async (claims: JobClaims, write: GuardedWrite) => { try { await claims.complete(write) } catch { return } }` },
            ],
            invalid: [
                { filename: OWNER_PORT, code: `import type { LooseWrite } from "./jobs.contracts"\nexport interface JobClaims {\n advance(write: LooseWrite): Promise<void>\n}`, errors: [{ messageId: "optionalToken" }] },
                { filename: STEP, code: `${CLAIMS}export const run = (claims: JobClaims) => claims.complete({ jobId: "a", expectedFencingToken: undefined as unknown as number })`, errors: [{ messageId: "cast" }, { messageId: "cast" }] },
                { filename: STEP, code: `${CLAIMS}export const run = (claims: JobClaims, job: { jobId: string; fencingToken?: number }) => claims.complete({ jobId: job.jobId, expectedFencingToken: job.fencingToken! })`, errors: [{ messageId: "cast" }] },
                { filename: STEP, code: `${CLAIMS}export const run = async (claims: JobClaims, write: GuardedWrite) => { try { await claims.complete(write) } catch (error) { console.log(error) } }`, errors: [{ messageId: "swallowed" }] },
            ],
        })
    })
})

const STEP_HEAD = `import type { ClaimedJob } from "@modules/platform/jobs"
import { onceAnswered, type Effects } from "@modules/platform/effects"
import { MailGateway } from "@modules/integrations/mailer/mail.gateway"
`

test("job-effect-piece: an outside call of a job is the act or the confirm of Effects.once", () => {
    assert.doesNotThrow(() => {
        tester.run("job-effect-piece", jobEffectPiece, {
            valid: [
                { filename: STEP, code: `${STEP_HEAD}export class MailStep { constructor(private readonly mail: MailGateway, private readonly effects: Effects) {}\n run(job: ClaimedJob): Promise<void> { return this.effects.once(job.jobId + ":mail", { name: "mail.send", settle: "repeatable" }, { act: () => this.mail.send("a") }) } }` },
                { filename: STEP, code: `${STEP_HEAD}export class MailStep { constructor(private readonly mail: MailGateway, private readonly effects: Effects) {}\n run(job: ClaimedJob): Promise<string> { return this.effects.once(job.jobId + ":mail", { name: "mail.send", settle: "confirm" }, { act: async () => { await this.mail.send("a"); return "sent" }, confirm: async () => (await this.mail.status("a")) }) } }` },
                // a function that takes a job in the domain is judged the same way
                { filename: DOMAIN, code: `${STEP_HEAD}export class Placing { constructor(private readonly mail: MailGateway, private readonly effects: Effects) {}\n run(job: ClaimedJob): Promise<void> { return this.effects.once(job.jobId + ":mail", { name: "mail.send", settle: "repeatable" }, { act: () => this.mail.send("a") }) } }` },
                // a domain method no job reaches calls its port as before
                { filename: DOMAIN, code: `${STEP_HEAD}export class Reading { constructor(private readonly mail: MailGateway) {}\n read(): Promise<string> { return this.mail.status("a") } }` },
                { filename: HANDLER, code: `${STEP_HEAD}export const read = (mail: MailGateway) => mail.status("a")` },
                // a helper of the piece handed the Effects port runs the act it is passed inside its own Effects.once
                { filename: DOMAIN, code: `${STEP_HEAD}export class Placing { constructor(private readonly mail: MailGateway, private readonly effects: Effects) {}
 run(job: ClaimedJob): Promise<string> { return onceAnswered(this.effects, job.jobId + ":read", { name: "mail.status", settle: "repeatable" }, () => this.mail.status("a")) } }` },
                // an act bound to a const and handed on as the act of the call object
                { filename: DOMAIN, code: `${STEP_HEAD}export class Placing { constructor(private readonly mail: MailGateway, private readonly effects: Effects) {}
 run(job?: ClaimedJob): Promise<void> { const act = (): Promise<void> => this.mail.send("a"); if (job === undefined) return act(); return this.effects.once(job.jobId + ":mail", { name: "mail.send", settle: "repeatable" }, { act }) } }` },
                // a member its port declares an outside read (OutsideReads of platform/effects) has no intent to protect
                { filename: DOMAIN, code: `${STEP_HEAD}import type { MailBox, MailReader } from "@modules/integrations/mailer/mail-box.port"
import type { FakeBox } from "@modules/integrations/mailer/own-reads.port"
export class Placing { constructor(private readonly box: MailBox) {}
 run(job: ClaimedJob): Promise<string> { return this.box.status(job.jobId) } }` },
                { filename: STEP, code: `${STEP_HEAD}import type { MailBox, MailReader } from "@modules/integrations/mailer/mail-box.port"
import type { FakeBox } from "@modules/integrations/mailer/own-reads.port"
export const run = async (box: MailBox) => (await box.list()).length` },
                // a class declares its reads by implementing the marker
                { filename: DOMAIN, code: `${STEP_HEAD}import type { MailBox, MailReader } from "@modules/integrations/mailer/mail-box.port"
import type { FakeBox } from "@modules/integrations/mailer/own-reads.port"
export class Placing { constructor(private readonly reader: MailReader) {}
 run(job: ClaimedJob): Promise<string> { return this.reader.status(job.jobId) } }` },
            ],
            invalid: [
                { filename: STEP, code: `${STEP_HEAD}export const run = (mail: MailGateway) => mail.status("a")`, errors: [{ messageId: "outside" }] },
                { filename: STEP, code: `${STEP_HEAD}export class MailStep { constructor(private readonly mail: MailGateway) {}\n run(job: ClaimedJob): Promise<void> { return this.mail.send(job.jobId) } }`, errors: [{ messageId: "outside" }] },
                { filename: DOMAIN, code: `${STEP_HEAD}export class Placing { constructor(private readonly mail: MailGateway) {}\n run(job: ClaimedJob): Promise<void> { return this.mail.send(job.jobId) } }`, errors: [{ messageId: "outside" }] },
                // a closure of a job function is still the job's
                { filename: DOMAIN, code: `${STEP_HEAD}export class Placing { constructor(private readonly mail: MailGateway) {}\n async run(job: ClaimedJob): Promise<void> { await Promise.all(["a", "b"].map((to) => this.mail.send(to + job.jobId))) } }`, errors: [{ messageId: "outside" }] },
                // a const act that is only called, never handed to the piece, is a bare call
                { filename: DOMAIN, code: `${STEP_HEAD}export class Placing { constructor(private readonly mail: MailGateway) {}
 run(job: ClaimedJob): Promise<void> { const act = (): Promise<void> => this.mail.send(job.jobId); return act() } }`, errors: [{ messageId: "outside" }] },
                // a function of the app that is handed the Effects port is no helper of the piece
                { filename: DOMAIN, code: `${STEP_HEAD}const mine = (effects: Effects, act: () => Promise<void>): Promise<void> => act()
export class Placing { constructor(private readonly mail: MailGateway, private readonly effects: Effects) {}
 run(job: ClaimedJob): Promise<void> { return mine(this.effects, () => this.mail.send(job.jobId)) } }`, errors: [{ messageId: "outside" }] },
                // a member the port does not declare a read is an act, even on a port that declares other reads
                { filename: DOMAIN, code: `${STEP_HEAD}import type { MailBox, MailReader } from "@modules/integrations/mailer/mail-box.port"
import type { FakeBox } from "@modules/integrations/mailer/own-reads.port"
export class Placing { constructor(private readonly box: MailBox) {}
 run(job: ClaimedJob): Promise<void> { return this.box.send(job.jobId) } }`, errors: [{ messageId: "outside" }] },
                { filename: DOMAIN, code: `${STEP_HEAD}import type { MailBox, MailReader } from "@modules/integrations/mailer/mail-box.port"
import type { FakeBox } from "@modules/integrations/mailer/own-reads.port"
export class Placing { constructor(private readonly reader: MailReader) {}
 run(job: ClaimedJob): Promise<void> { return this.reader.send(job.jobId) } }`, errors: [{ messageId: "outside" }] },
                // a read used to decide an act does not excuse the act
                { filename: DOMAIN, code: `${STEP_HEAD}import type { MailBox, MailReader } from "@modules/integrations/mailer/mail-box.port"
import type { FakeBox } from "@modules/integrations/mailer/own-reads.port"
export class Placing { constructor(private readonly box: MailBox) {}
 async run(job: ClaimedJob): Promise<void> { if ((await this.box.status(job.jobId)) !== "sent") await this.box.send(job.jobId) } }`, errors: [{ messageId: "outside" }] },
                // a look-alike marker declared outside platform/effects declares nothing
                { filename: DOMAIN, code: `${STEP_HEAD}import type { MailBox, MailReader } from "@modules/integrations/mailer/mail-box.port"
import type { FakeBox } from "@modules/integrations/mailer/own-reads.port"
export class Placing { constructor(private readonly box: FakeBox) {}
 run(job: ClaimedJob): Promise<string> { return this.box.status(job.jobId) } }`, errors: [{ messageId: "outside" }] },
                // the key of the piece is not the act: an outside call there is a bare call
                { filename: DOMAIN, code: `${STEP_HEAD}export class Placing { constructor(private readonly mail: MailGateway, private readonly effects: Effects) {}\n async run(job: ClaimedJob): Promise<void> { await this.effects.once(await this.mail.status(job.jobId), { name: "mail.send", settle: "repeatable" }, { act: async () => undefined }) } }`, errors: [{ messageId: "outside" }] },
            ],
        })
    })
})

const JOBS_HEAD = `import { defineJob } from "@modules/platform/jobs"
import { FACTS_JOB, RUN_JOB, SearchJob } from "@modules/queues/search/search.jobs"
`
const QUEUE_JOBS = at("src/modules/queues/search/other.jobs.ts")
const DECLARE = (next: string): string => `${JOBS_HEAD}const guard = (value: unknown): value is { id: string } => typeof value === "object"
export const OTHER_JOB = defineJob<{ id: string }>({ name: "search.other", queue: "search", ladder: "background", payload: guard, onceKey: (payload) => payload.id, next: ${next}, effects: [] })
void FACTS_JOB
void RUN_JOB
`

test("job-next-declared: next is an array of readable names of declared jobs", () => {
    assert.doesNotThrow(() => {
        tester.run("job-next-declared", jobNextDeclared, {
            valid: [
                { filename: QUEUE_JOBS, code: DECLARE("[SearchJob.Facts]") },
                { filename: QUEUE_JOBS, code: DECLARE("[SearchJob.Run, SearchJob.Facts]") },
                { filename: QUEUE_JOBS, code: DECLARE("[]") },
                { filename: QUEUE_JOBS, code: DECLARE("[\"search.facts\"]") },
                // outside the queues slot nothing is judged
                { filename: DOMAIN, code: DECLARE("[\"search.nothing\"]") },
            ],
            invalid: [
                { filename: QUEUE_JOBS, code: DECLARE("[\"search.nothing\"]"), errors: [{ messageId: "unknown" }] },
                { filename: QUEUE_JOBS, code: DECLARE("[SearchJob.Facts, \"search.gone\"]"), errors: [{ messageId: "unknown" }] },
                { filename: QUEUE_JOBS, code: `${DECLARE("NEXT_OF_OTHER")}`.replace("export const OTHER_JOB", "const NEXT_OF_OTHER: string[] = []\nexport const OTHER_JOB"), errors: [{ messageId: "shape" }] },
                { filename: QUEUE_JOBS, code: `${DECLARE("[...[SearchJob.Facts]]")}`, errors: [{ messageId: "shape" }] },
                { filename: QUEUE_JOBS, code: `${DECLARE("[(\"search.\" + \"facts\") as string]")}`, errors: [{ messageId: "literal" }] },
            ],
        })
    })
})

const PROGRESS_HEAD = `import type { ClaimedJob, JobProgress, JobProgressTopic } from "@modules/platform/jobs"
import { defineJob } from "@modules/platform/jobs"
import { RealtimeHub } from "@modules/platform/realtime"
`
const PROGRESS_JOB = (progress: string): string => `${PROGRESS_HEAD}const guard = (value: unknown): value is { id: string } => typeof value === "object"
const topicOf = (payload: { id: string }): JobProgressTopic => ({ principalId: payload.id, root: "source:" + payload.id })
export const PROGRESS_JOB = defineJob<{ id: string }>({ name: "search.view", queue: "search", ladder: "background", payload: guard, onceKey: (payload) => payload.id, next: [], effects: [], progress: ${progress} })
void topicOf
`

test("job-progress-shape: the progress topic is principal first, and the frame publishes it", () => {
    assert.doesNotThrow(() => {
        tester.run("job-progress-shape", jobProgressShape, {
            valid: [
                { filename: QUEUE_JOBS, code: PROGRESS_JOB("{ topic: topicOf }") },
                { filename: QUEUE_JOBS, code: PROGRESS_JOB("undefined") },
                { filename: DOMAIN, code: `${PROGRESS_HEAD}export class Indexing { constructor(private readonly progress: JobProgress) {}\n run(job: ClaimedJob): Promise<void> { return this.progress.report(job, 1, 2, "search.read") } }` },
                // a function that takes no job may publish through the hub
                { filename: DOMAIN, code: `${PROGRESS_HEAD}export class Telling { constructor(private readonly hub: RealtimeHub) {}\n tell(): void { this.hub.publish("orders:a", {}) } }` },
            ],
            invalid: [
                { filename: QUEUE_JOBS, code: PROGRESS_JOB("{ topic: (payload: { id: string }) => ({ principalId: payload.id, root: \"source:\" + payload.id }) }"), errors: [{ messageId: "topic" }] },
                { filename: DOMAIN, code: `${PROGRESS_HEAD}export class Indexing { constructor(private readonly hub: RealtimeHub) {}\n run(job: ClaimedJob): void { this.hub.publish("job-progress:" + job.jobId, { done: 1 }) } }`, errors: [{ messageId: "hub" }] },
                { filename: DOMAIN, code: `${PROGRESS_HEAD}export class Indexing { constructor(private readonly hub: RealtimeHub) {}\n run(job: ClaimedJob): void { [1].forEach((done) => this.hub.publish("job-progress:" + job.jobId, { done })) } }`, errors: [{ messageId: "hub" }] },
            ],
        })
    })
})

const SHAPE_HEAD = `import type { ClaimedJob, JobStep } from "@modules/platform/jobs"
import { FencedProcessor } from "@modules/platform/jobs"
`

test("job-shape: a processor extends the fenced base in its job folder and a step implements JobStep in steps/", () => {
    assert.doesNotThrow(() => {
        tester.run("job-shape", jobShape, {
            valid: [
                { filename: PROCESSOR, code: `${SHAPE_HEAD}export class SendProcessor extends FencedProcessor { async process(job: ClaimedJob): Promise<void> { void job } }` },
                { filename: STEP, code: `${SHAPE_HEAD}export class MailStep implements JobStep { async run(job: ClaimedJob): Promise<void> { void job } }` },
                { filename: at("src/modules/platform/jobs/claim-runner.processor.ts"), code: `export abstract class Base { abstract process(): Promise<void> }` },
                { filename: DOMAIN, code: `export class Plain { run(): number { return 1 } }` },
            ],
            invalid: [
                { filename: PROCESSOR, code: `export class SendProcessor { async process(): Promise<void> {} }`, errors: [{ messageId: "notFenced" }] },
                { filename: at("src/features/jobs/send/transport/queue/other.processor.ts"), code: `${SHAPE_HEAD}export class OtherProcessor extends FencedProcessor { async process(job: ClaimedJob): Promise<void> { void job } }`, errors: [{ messageId: "processorStem" }] },
                { filename: at("src/features/checkout/application/send.processor.ts"), code: `${SHAPE_HEAD}export class SendProcessor extends FencedProcessor { async process(job: ClaimedJob): Promise<void> { void job } }`, errors: [{ messageId: "processorPlacement" }] },
                { filename: STEP, code: `export class MailStep { async run(): Promise<void> {} }`, errors: [{ messageId: "notStep" }] },
                { filename: at("src/features/checkout/application/mail.step.ts"), code: `${SHAPE_HEAD}export class MailStep implements JobStep { async run(job: ClaimedJob): Promise<void> { void job } }`, errors: [{ messageId: "stepPlacement" }] },
                { filename: HANDLER, code: `${SHAPE_HEAD}export class Sneaky implements JobStep { async run(job: ClaimedJob): Promise<void> { void job } }`, errors: [{ messageId: "stepPlacement" }] },
            ],
        })
    })
})
