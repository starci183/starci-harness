import { contractCheckVerb } from "./core/contract/check.js"
import { contractNewVerb } from "./core/contract/new.js"
import { taskVerifyVerb } from "./core/task/verify.js"
import { taskSendVerb } from "./core/task/send.js"
import { taskStatusVerb } from "./core/task/status.js"
import { taskResultVerb } from "./core/task/result.js"
import { taskCancelVerb } from "./core/task/cancel.js"
import { checkLintVerb } from "./core/check/lint.js"
import { checkRunVerb } from "./core/check/run.js"
import { checkTypecheckVerb } from "./core/check/typecheck.js"
import { doctorVerb } from "./core/doctor.js"
import { explainVerb } from "./core/explain.js"
import { ciStatusVerb } from "./core/release/ci-status.js"
import { releaseCutVerb } from "./core/release/cut.js"
import { releasePublishVerb } from "./core/release/publish.js"
import { releasePushVerb } from "./core/release/push.js"
import { versionVerb } from "./core/version.js"
import { appInfoVerb } from "./lite/app/info.js"
import { seatListVerb } from "./core/seat/list.js"
import { seatStartVerb } from "./core/seat/start.js"
import { seatStopVerb } from "./core/seat/stop.js"
import { checkLooseningVerb } from "./core/check/loosening.js"
import { checkSecretsVerb } from "./core/check/secrets.js"
import { checkCiVerb } from "./core/check/ci.js"
import { workflowDefineVerb } from "./core/workflow/define.js"
import { workflowStartVerb } from "./core/workflow/start.js"
import { workflowStatusVerb } from "./core/workflow/status.js"
import { workflowListVerb } from "./core/workflow/list.js"
import { workflowStepVerb } from "./core/workflow/step.js"
import { workflowAmendVerb } from "./core/workflow/amend.js"
import { workflowStopVerb } from "./core/workflow/stop.js"
import { planShowVerb } from "./core/plan/show.js"
import { planDiffVerb } from "./core/plan/diff.js"
import { routeExplainVerb } from "./core/route/explain.js"
import { providerStatusVerb } from "./core/provider/status.js"
import { providerRecoverVerb } from "./core/provider/recover.js"
import { providerReportVerb } from "./core/provider/report.js"
import { budgetShowVerb } from "./core/budget/show.js"
import { budgetRaiseVerb } from "./core/budget/raise.js"
import { workflowPauseVerb } from "./core/workflow/pause.js"
import { workflowResumeVerb } from "./core/workflow/resume.js"
import { workflowRunVerb } from "./core/workflow/run.js"
import { seatPingVerb } from "./core/seat/ping.js"
import { uatRunVerb } from "./core/uat/run.js"
import type { AnyVerb, TreeKind } from "./shared/verb.js"

// Each definition is widened once here; the registry is the only place that erases verb types.
const widen = (verb: object): AnyVerb => verb as AnyVerb

/** Every verb this build knows, core first, then each edition. */
export const ALL_VERBS: readonly AnyVerb[] = [
    versionVerb,
    explainVerb,
    doctorVerb,
    checkRunVerb,
    checkLintVerb,
    checkTypecheckVerb,
    releasePushVerb,
    releaseCutVerb,
    releasePublishVerb,
    ciStatusVerb,
    contractNewVerb,
    contractCheckVerb,
    taskVerifyVerb,
    taskSendVerb,
    taskStatusVerb,
    taskResultVerb,
    taskCancelVerb,
    appInfoVerb,
    seatStartVerb,
    seatListVerb,
    seatStopVerb,
    checkLooseningVerb,
    checkSecretsVerb,
    checkCiVerb,
    workflowDefineVerb,
    workflowStartVerb,
    workflowStatusVerb,
    workflowListVerb,
    workflowStepVerb,
    workflowAmendVerb,
    workflowStopVerb,
    planShowVerb,
    planDiffVerb,
    routeExplainVerb,
    providerStatusVerb,
    providerRecoverVerb,
    providerReportVerb,
    budgetShowVerb,
    budgetRaiseVerb,
    workflowPauseVerb,
    workflowResumeVerb,
    workflowRunVerb,
    seatPingVerb,
    uatRunVerb,
].map(widen)

/** The verbs a tree offers: an app sees core plus its own edition; the runtime and a bare directory see everything. */
export const verbsFor = (tree: TreeKind): readonly AnyVerb[] => {
    if (tree === "lite" || tree === "full") return ALL_VERBS.filter((verb) => verb.editions.includes(tree))
    return ALL_VERBS
}
