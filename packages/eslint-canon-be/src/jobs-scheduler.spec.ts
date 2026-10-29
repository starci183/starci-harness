/**
 * Twin tests for the tick scheduler law (R335 `BE_JOBS_SCHEDULER_OWNER`).
 *
 *   node --test src/jobs-scheduler.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.mjs"
import { at, fixtureHfs } from "../fixtures/typed/tester.mjs"
import { jobsSchedulerOwner, rules } from "./jobs-scheduler.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})

const TICKS = at("src/modules/platform/jobs/job-tick.service.ts")
const TICKS_SPEC = at("src/modules/platform/jobs/job-tick.service.spec.ts")
const JOBS_MODULE = at("src/modules/platform/jobs/jobs.module.ts")
const CLAIMS = at("src/modules/platform/jobs/job-claim.service.ts")
const DOMAIN = at("src/modules/domain/order/order.service.ts")
const QUEUE = at("src/modules/platform/queue/queue.module.ts")

const FENCED = `import { SchedulerRegistry } from "@nestjs/schedule"
import { CronJob } from "cron"
declare const advisoryXactLock: (tx: unknown, key: string) => Promise<void>
declare const callDbFunction: (tx: unknown, name: string, args: unknown[]) => Promise<unknown[]>
export const fire = async (tx: unknown, registry: SchedulerRegistry) => {
    await advisoryXactLock(tx, "tick:digest")
    await callDbFunction(tx, "job_tick_claim", ["digest", "2026-02-03T04:05"])
    return [registry, CronJob]
}`

test("the law publishes its rule under its name", () => {
    assert.equal(rules["jobs-scheduler-owner"], jobsSchedulerOwner)
})

test("jobs-scheduler-owner: the tick scheduler of platform/jobs alone schedules, under its lock and minute claim", () => {
    tester.run("jobs-scheduler-owner", jobsSchedulerOwner, {
        valid: [
            { filename: TICKS, code: FENCED },
            { filename: TICKS_SPEC, code: `import { SchedulerRegistry } from "@nestjs/schedule"\nexport const token = SchedulerRegistry` },
            { filename: JOBS_MODULE, code: `import { ScheduleModule } from "@nestjs/schedule"\nexport const imports = [ScheduleModule.forRoot()]` },
            { filename: DOMAIN, code: `export const tick = "nightly"` },
        ],
        invalid: [
            // another file of platform/jobs is not the scheduler
            { filename: CLAIMS, code: `import { CronJob } from "cron"\nexport { CronJob }`, errors: [{ messageId: "owner" }] },
            // and nothing outside platform/jobs schedules
            { filename: DOMAIN, code: `import { SchedulerRegistry } from "@nestjs/schedule"\nexport { SchedulerRegistry }`, errors: [{ messageId: "owner" }] },
            { filename: QUEUE, code: `import { CronTime } from "cron/dist/time"\nexport { CronTime }`, errors: [{ messageId: "owner" }] },
            // a decorated method fires once per replica, even inside the scheduler's own files
            { filename: DOMAIN, code: `import { Cron } from "@nestjs/schedule"\nexport { Cron }`, errors: [{ messageId: "decorator" }, { messageId: "owner" }] },
            { filename: JOBS_MODULE, code: `import { Interval, ScheduleModule } from "@nestjs/schedule"\nexport { Interval, ScheduleModule }`, errors: [{ messageId: "decorator" }] },
            // the tick service enqueues only under the lock and the minute claim
            { filename: TICKS, code: FENCED.replace(`    await advisoryXactLock(tx, "tick:digest")\n`, ""), errors: [{ messageId: "fence" }] },
            { filename: TICKS, code: FENCED.replace(`"job_tick_claim"`, `"job_claim"`), errors: [{ messageId: "fence" }] },
        ],
    })
})
