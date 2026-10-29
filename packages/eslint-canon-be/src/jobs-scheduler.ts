/**
 * The tick scheduler law (catalog R335 `BE_JOBS_SCHEDULER_OWNER`; contexts/code/be/jobs.md BE-JOBS-6): recurring work is a tick of
 * `platform/jobs`, fired once per minute for the whole deployment.
 *
 *   - `jobs-scheduler-owner` refuses an import of `@nestjs/schedule` or `cron` (or a subpath) outside the three files of
 *     `platform/jobs` that hold the scheduler (`job-tick.service.ts`, its spec, and `jobs.module.ts`, which composes
 *     `ScheduleModule.forRoot()`), refuses the `Cron`, `Interval` and `Timeout` decorators of `@nestjs/schedule` everywhere (a
 *     decorated method fires on every replica), and refuses a `job-tick.service.ts` that does not call both `advisoryXactLock`
 *     and `callDbFunction(..., "job_tick_claim", ...)`: the lock serialises the replicas and the minute claim lets one enqueue.
 *
 * `infra-import-owner` (R90) holds the coarser half from the same table (`ruleParams.be.infraOwners` gives both libraries to
 * `platform/jobs`); this rule names the files and the fence.
 */
import path from "node:path"
import { staticText } from "./lib/ast.ts"
import { hfsOf } from "./lib/hfs.ts"
import { moduleReferences } from "./lib/import-source.ts"
import type { Node, Recommended, RuleModule, Rules } from "./lib/rule.ts"

/** The owner id (`<tier>/<capability>`) of the tick scheduler. */
const JOBS_OWNER = "platform/jobs"
/** The libraries of the scheduler. */
const SCHEDULER_LIBRARIES = ["@nestjs/schedule", "cron"]
/** The files of platform/jobs that may import them. */
const SCHEDULER_FILES = new Set(["job-tick.service.ts", "job-tick.service.spec.ts", "jobs.module.ts"])
/** The file that fires the ticks and must hold the fence. */
const TICK_SERVICE = "job-tick.service.ts"
/** The decorators that would fire once per replica. */
const REPLICA_DECORATORS = new Set(["Cron", "Interval", "Timeout"])
/** The database function that claims a tick's minute. */
const TICK_CLAIM = "job_tick_claim"

/** True when a module specifier is a scheduler library or a subpath of one. */
const isSchedulerLibrary = (specifier: string): boolean =>
    SCHEDULER_LIBRARIES.some((library) => specifier === library || specifier.startsWith(`${library}/`))

/** Recurring work is a platform/jobs tick: the scheduler libraries stay in its files, no replica decorator, and the tick holds its fence. */
export const jobsSchedulerOwner: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Only the tick scheduler of platform/jobs imports @nestjs/schedule or cron, no file uses a Cron, Interval or Timeout decorator, and the tick service locks and claims each minute before it enqueues." },
        schema: [],
        messages: {
            owner: "`{{library}}` is imported outside the tick scheduler of platform/jobs (job-tick.service.ts, jobs.module.ts). Declare the tick in JOB_TICKS of platform/jobs/job-ticks.contracts.ts instead.",
            decorator: "`@{{name}}` of @nestjs/schedule fires once per replica. Declare the tick in JOB_TICKS of platform/jobs/job-ticks.contracts.ts; JobTickService fires it once per minute for the deployment.",
            fence: "JobTickService must take `advisoryXactLock(tx, \"tick:<name>\")` and claim the minute with `callDbFunction(tx, \"job_tick_claim\", ...)` before it writes the outbox, or every replica enqueues the tick.",
        },
    },
    create(context) {
        const hfs = hfsOf(context)
        const root = hfs.ownerOf(context.filename)
        const inJobs = root !== null && root.split("/").slice(-2).join("/") === JOBS_OWNER
        const base = path.basename(context.filename)
        const mayImport = inJobs && SCHEDULER_FILES.has(base)
        const tickService = inJobs && base === TICK_SERVICE
        let locks = false
        let claims = false
        return {
            ...moduleReferences((reference) => {
                if (!isSchedulerLibrary(reference.value)) return
                if (!mayImport) context.report({ node: reference.source, messageId: "owner", data: { library: reference.value } })
                if (reference.value !== "@nestjs/schedule") return
                for (const name of reference.names) {
                    if (name !== null && REPLICA_DECORATORS.has(name)) context.report({ node: reference.node, messageId: "decorator", data: { name } })
                }
            }),
            CallExpression(node) {
                if (!tickService || node.callee.type !== "Identifier") return
                if (node.callee.name === "advisoryXactLock") locks = true
                const second: Node | undefined = node.arguments[1]
                if (node.callee.name === "callDbFunction" && staticText(second) === TICK_CLAIM) claims = true
            },
            "Program:exit"(node: Node) {
                if (tickService && !(locks && claims)) context.report({ node, messageId: "fence" })
            },
        }
    },
}

/** The rule of the tick scheduler law, by name. */
export const rules = { "jobs-scheduler-owner": jobsSchedulerOwner } satisfies Rules
/** On at error in both editions. */
export const recommended: Recommended = { "starci-be/jobs-scheduler-owner": "error" }
