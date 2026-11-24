import { contractCheckVerb } from "./core/contract/check.js"
import { contractNewVerb } from "./core/contract/new.js"
import { taskVerifyVerb } from "./core/task/verify.js"
import { taskSendVerb } from "./core/task/send.js"
import { taskStatusVerb } from "./core/task/status.js"
import { taskResultVerb } from "./core/task/result.js"
import { taskCancelVerb } from "./core/task/cancel.js"
import { checkLintVerb } from "./core/check/lint.js"
import { checkRunVerb } from "./core/check/run.js"
import { doctorVerb } from "./core/doctor.js"
import { explainVerb } from "./core/explain.js"
import { releaseAffectedVerb } from "./core/release/affected.js"
import { releaseCutVerb } from "./core/release/cut.js"
import { releasePublishVerb } from "./core/release/publish.js"
import { releasePushVerb } from "./core/release/push.js"
import { releaseGateVerb } from "./core/release/gate.js"
import { releaseBackMergeVerb } from "./core/release/back-merge.js"
import { versionVerb } from "./core/version.js"
import { appInfoVerb } from "./core/app/info.js"
import { appMasterPlanVerb } from "./core/app/master-plan.js"
import { appAddVerb } from "./core/app/add.js"
import { appCheckVerb } from "./core/app/check.js"
import { appCiVerb } from "./core/app/ci.js"
import { appCodemodVerb } from "./core/app/codemod.js"
import { appAuditVerb } from "./core/app/audit.js"
import { auditCycleVerb, auditRunVerb, auditStatusVerb, galleryMigrateVerb } from "./core/app/ui-audit.js"
import { appCoverageVerb } from "./core/app/coverage.js"
import { appDataVerb } from "./core/app/data.js"
import { dataStandardVerb } from "./core/data/standard.js"
import { appDbVerb } from "./core/app/db.js"
import { appDesktopVerb } from "./core/app/desktop.js"
import { appEmitVerb } from "./core/app/emit.js"
import { appPushVerb } from "./core/app/push.js"
import { appReleaseVerb } from "./core/app/release.js"
import { appScaffoldVerb } from "./core/app/scaffold.js"
import { appAlertsVerb } from "./core/app/alerts.js"
import { appSecretVerb } from "./core/app/secret.js"
import { appStackVerb } from "./core/app/stack.js"
import { appSyncVerb } from "./core/app/sync.js"
import { appUpgradeVerb } from "./core/app/upgrade.js"
import { appSlotVerb } from "./core/app/slot.js"
import { appWorldVerb } from "./core/app/world.js"
import { projectParkVerb } from "./core/project/park.js"
import { projectRetireVerb } from "./core/project/retire.js"
import { projectUnparkVerb } from "./core/project/unpark.js"
import { seatListVerb } from "./core/seat/list.js"
import { seatStartVerb } from "./core/seat/start.js"
import { seatStopVerb } from "./core/seat/stop.js"
import { checkLooseningVerb } from "./core/check/loosening.js"
import { checkSecretsVerb } from "./core/check/secrets.js"
import { checkShapeVerb } from "./core/check/shape.js"
import { checkPinsVerb } from "./core/check/pins.js"
import { checkHeavySitesVerb } from "./core/check/heavy-sites.js"
import { checkCiVerb } from "./core/check/ci.js"
import { workflowDefineVerb } from "./core/workflow/define.js"
import { workflowStartVerb } from "./core/workflow/start.js"
import { workflowStatusVerb } from "./core/workflow/status.js"
import { workflowListVerb } from "./core/workflow/list.js"
import { workflowStepVerb } from "./core/workflow/step.js"
import { workflowWaveVerb } from "./core/workflow/wave.js"
import { workflowAmendVerb } from "./core/workflow/amend.js"
import { workflowStopVerb } from "./core/workflow/stop.js"
import { planShowVerb } from "./core/plan/show.js"
import { planDiffVerb } from "./core/plan/diff.js"
import { routeShowVerb } from "./core/route/show.js"
import { providerStatusVerb } from "./core/provider/status.js"
import { providerRecoverVerb } from "./core/provider/recover.js"
import { providerReportVerb } from "./core/provider/report.js"
import { providerSyncVerb } from "./core/provider/sync.js"
import { budgetShowVerb } from "./core/budget/show.js"
import { budgetRaiseVerb } from "./core/budget/raise.js"
import { workflowPauseVerb } from "./core/workflow/pause.js"
import { worktreeGcVerb } from "./core/worktree/gc.js"
import { workflowResumeVerb } from "./core/workflow/resume.js"
import { seatPingVerb } from "./core/seat/ping.js"
import { uatRunVerb } from "./core/uat/run.js"
import { testLiveVerb } from "./core/test/live.js"
import { testE2eVerb, testIntegrationVerb } from "./core/test/world.js"
import { contextsAnatomyVerb } from "./core/contexts/anatomy.js"
import { contextsAnchorVerb } from "./core/contexts/anchors-verb.js"
import { contextsSearchVerb } from "./core/contexts/search.js"
import { supervisorStartVerb } from "./core/supervisor/start.js"
import { supervisorStatusVerb } from "./core/supervisor/status.js"
import { supervisorStopVerb } from "./core/supervisor/stop.js"
import { supervisorAskVerb } from "./core/supervisor/ask.js"
import { supervisorAttachVerb } from "./core/supervisor/attach.js"
import { kernelStartVerb } from "./core/kernel/start.js"
import { kernelAttachVerb } from "./core/kernel/attach.js"
import { kernelNextVerb } from "./core/kernel/next.js"
import { kernelSubmitVerb } from "./core/kernel/submit.js"
import { supervisorEnsureVerb } from "./core/supervisor/ensure.js"
import { supervisorNextVerb } from "./core/supervisor/next.js"
import { supervisorDispatchVerb } from "./core/supervisor/dispatch.js"
import { supervisorWorkersVerb } from "./core/supervisor/worker-list.js"
import { needsListVerb } from "./core/needs/list.js"
import { needsShowVerb } from "./core/needs/show.js"
import { needsMergeVerb } from "./core/needs/merge.js"
import { needsReopenVerb } from "./core/needs/reopen.js"
import { supervisorAcceptVerb } from "./core/supervisor/accept.js"
import { supervisorRejectVerb } from "./core/supervisor/reject.js"
import { supervisorSubmitVerb } from "./core/supervisor/submit.js"
import { supervisorTickVerb } from "./core/supervisor/tick.js"
import { connectTelegramVerb } from "./core/connect/telegram.js"
import { hostStatusVerb } from "./core/host/status.js"
import { hostGuardVerb } from "./core/host/guard.js"
import { hostLoadVerb } from "./core/host/load.js"
import { hostUpVerb } from "./core/host/up.js"
import { hostDownVerb } from "./core/host/down.js"
import { hostInstallVerb } from "./core/host/install.js"
import { hostDoctorVerb } from "./core/host/doctor.js"
import { hostUninstallVerb } from "./core/host/uninstall.js"
import { vpsDoctorVerb, vpsListVerb } from "./core/vps/read.js"
import { vpsBootstrapVerb, vpsSwarmVerb, vpsUiVerb } from "./core/vps/act.js"
import { vpsAddVerb, vpsGrantVerb, vpsRevokeVerb } from "./core/vps/access.js"
import { vpsRemoveVerb, vpsSetVerb, vpsShowVerb } from "./core/vps/machines.js"
import { vpsCloudflareVerb, vpsDomainVerb, vpsEdgeVerb } from "./core/vps/domain.js"
import { vpsMonitorVerb } from "./core/vps/monitor.js"
import { vpsServiceVerb } from "./core/vps/service.js"
import { vpsBuildKeyVerb } from "./core/vps/build-key.js"
import { configListVerb } from "./core/config/list.js"
import { configGetVerb } from "./core/config/get.js"
import { configSetVerb } from "./core/config/set.js"
import { uiVerb } from "./core/ui/serve.js"
import { dnaCheckVerb } from "./core/dna/check.js"
import { depsCheckVerb } from "./core/deps/check.js"
import { depsPublishLocalVerb } from "./core/deps/publish-local.js"
import { depsPublishDevVerb } from "./core/deps/publish-dev.js"
import { depsInstallLocalVerb } from "./core/deps/install-local.js"
import { pkgBranchVerb } from "./core/pkg/branch.js"
import { pkgHandoffVerb } from "./core/pkg/handoff.js"
import { pkgTestVerb } from "./core/pkg/test.js"
import { ticketAnswerVerb } from "./core/ticket/answer.js"
import { ticketCloseVerb } from "./core/ticket/close.js"
import { ticketListVerb } from "./core/ticket/list.js"
import { ticketOpenVerb } from "./core/ticket/open.js"
import { ticketShowVerb } from "./core/ticket/show.js"
import { ticketTakeVerb } from "./core/ticket/take.js"
import { laneLandVerb } from "./core/lane/land.js"
import { devSyncVerb } from "./core/dev/sync.js"
import { devSyncRunnerVerb } from "./core/dev/sync-runner.js"
import { laneRemoveVerb } from "./core/lane/remove.js"
import { lanePruneInstallsVerb } from "./core/lane/prune-installs.js"
import { opsReapVerb } from "./core/ops/reap.js"
import { laneReadyVerb } from "./core/lane/ready.js"
import { laneStatusVerb } from "./core/lane/status.js"
import { laneCiWatchVerb } from "./core/lane/ci-watch.js"
import { laneWithdrawVerb } from "./core/lane/withdraw.js"
import { laneGateVerb } from "./core/lane/gate.js"
import { hotfixAbortVerb, hotfixLandVerb, hotfixStatusVerb } from "./core/hotfix/hotfix.js"
import { slotListVerb } from "./core/slot/list.js"
import { slotReleaseVerb } from "./core/slot/release.js"
import { slotRunVerb } from "./core/slot/run.js"
import { slotTakeVerb } from "./core/slot/take.js"
import { appLookVerb } from "./core/gallery/look.js"
import { galleryShootVerb } from "./core/gallery/shoot.js"
import type { AnyVerb, TreeKind } from "./shared/verb.js"

// Each definition is widened once here; the registry is the only place that erases verb types.
const widen = (verb: object): AnyVerb => verb as AnyVerb

/** Every verb this build knows. */
export const ALL_VERBS: readonly AnyVerb[] = [
    versionVerb,
    explainVerb,
    doctorVerb,
    checkRunVerb,
    checkLintVerb,
    releasePushVerb,
    releaseCutVerb,
    releasePublishVerb,
    releaseAffectedVerb,
    releaseGateVerb,
    releaseBackMergeVerb,
    contractNewVerb,
    contractCheckVerb,
    taskVerifyVerb,
    taskSendVerb,
    taskStatusVerb,
    taskResultVerb,
    taskCancelVerb,
    appInfoVerb,
    appMasterPlanVerb,
    appAddVerb,
    appCheckVerb,
    appCiVerb,
    appCodemodVerb,
    appCoverageVerb,
    appAuditVerb,
    auditRunVerb,
    auditCycleVerb,
    auditStatusVerb,
    galleryMigrateVerb,
    appDataVerb,
    dataStandardVerb,
    appDbVerb,
    appDesktopVerb,
    appEmitVerb,
    appPushVerb,
    appReleaseVerb,
    appScaffoldVerb,
    appAlertsVerb,
    appSecretVerb,
    appSlotVerb,
    appStackVerb,
    appSyncVerb,
    appUpgradeVerb,
    appWorldVerb,
    seatStartVerb,
    projectRetireVerb,
    projectParkVerb,
    projectUnparkVerb,
    seatListVerb,
    seatStopVerb,
    checkLooseningVerb,
    checkSecretsVerb,
    checkShapeVerb,
    checkPinsVerb,
    checkHeavySitesVerb,
    checkCiVerb,
    workflowDefineVerb,
    workflowStartVerb,
    workflowStatusVerb,
    workflowListVerb,
    workflowStepVerb,
    workflowWaveVerb,
    workflowAmendVerb,
    workflowStopVerb,
    planShowVerb,
    planDiffVerb,
    routeShowVerb,
    providerStatusVerb,
    providerRecoverVerb,
    providerReportVerb,
    providerSyncVerb,
    budgetShowVerb,
    budgetRaiseVerb,
    workflowPauseVerb,
    worktreeGcVerb,
    workflowResumeVerb,
    seatPingVerb,
    uatRunVerb,
    testLiveVerb,
    testIntegrationVerb,
    testE2eVerb,
    contextsAnatomyVerb,
    contextsAnchorVerb,
    contextsSearchVerb,
    supervisorStartVerb,
    supervisorStatusVerb,
    supervisorStopVerb,
    supervisorAskVerb,
    supervisorAttachVerb,
    kernelStartVerb,
    kernelAttachVerb,
    kernelNextVerb,
    kernelSubmitVerb,
    supervisorEnsureVerb,
    supervisorNextVerb,
    supervisorDispatchVerb,
    supervisorWorkersVerb,
    needsListVerb,
    needsShowVerb,
    needsMergeVerb,
    needsReopenVerb,
    supervisorAcceptVerb,
    supervisorRejectVerb,
    supervisorSubmitVerb,
    supervisorTickVerb,
    connectTelegramVerb,
    hostStatusVerb,
    hostGuardVerb,
    hostLoadVerb,
    hostUpVerb,
    hostDownVerb,
    hostInstallVerb,
    hostDoctorVerb,
    hostUninstallVerb,
    vpsListVerb,
    vpsDoctorVerb,
    vpsAddVerb,
    vpsShowVerb,
    vpsSetVerb,
    vpsRemoveVerb,
    vpsBootstrapVerb,
    vpsSwarmVerb,
    vpsUiVerb,
    vpsGrantVerb,
    vpsRevokeVerb,
    vpsEdgeVerb,
    vpsMonitorVerb,
    vpsServiceVerb,
    vpsBuildKeyVerb,
    vpsDomainVerb,
    vpsCloudflareVerb,
    configListVerb,
    configGetVerb,
    configSetVerb,
    uiVerb,
    dnaCheckVerb,
    depsInstallLocalVerb,
    depsPublishLocalVerb,
    depsPublishDevVerb,
    depsCheckVerb,
    pkgBranchVerb,
    pkgHandoffVerb,
    pkgTestVerb,
    ticketOpenVerb,
    ticketListVerb,
    ticketShowVerb,
    ticketTakeVerb,
    ticketCloseVerb,
    ticketAnswerVerb,
    laneReadyVerb,
    laneWithdrawVerb,
    laneStatusVerb,
    laneCiWatchVerb,
    laneLandVerb,
    devSyncVerb,
    devSyncRunnerVerb,
    laneGateVerb,
    hotfixLandVerb,
    hotfixStatusVerb,
    hotfixAbortVerb,
    slotTakeVerb,
    slotReleaseVerb,
    slotListVerb,
    slotRunVerb,
    appLookVerb,
    galleryShootVerb,
    laneRemoveVerb,
    lanePruneInstallsVerb,
    opsReapVerb,
].map(widen)

/** The verbs a tree offers: an app sees every verb but the runtime's own; the runtime and a bare directory see everything. */
export const verbsFor = (tree: TreeKind): readonly AnyVerb[] => (tree === "app" ? ALL_VERBS.filter((verb) => verb.runtimeOnly !== true) : ALL_VERBS)
