/**
 * The contract `starci ui` serves, copied from the desktop app (starci-harness-app `src/api/contract.ts`), which keeps its own
 * copy since the app is built without the CLI; a field changes in both copies at once, on the coordinator's call.
 *
 *   GET  /api/overview                              -> Overview
 *   GET  /api/workflows/:project/:workflow          -> WorkflowDetail
 *   GET  /api/tasks/:project/:task                  -> TaskDetail
 *   GET  /api/inbox                                 -> Decision[]
 *   POST /api/inbox/:project/:decision/ruling       Ruling -> ActionResult
 *   POST /api/workflows/:project/:workflow/:action  (pause | resume | stop-graceful | stop-hard) -> ActionResult
 *   POST /api/workflows/:project/:workflow/goal     { text: string } -> ActionResult (a new goal version; the Kernel re-plans)
 *   GET  /api/config                                -> ConfigEntry[]
 *   POST /api/config                                ConfigSet -> ActionResult
 *   GET  /api/events                                text/event-stream of LiveEvent (one `data:` JSON per change)
 */

/** A provider a pool draws on. */
export type ProviderId = "claude" | "codex" | "devin" | "cursor"
/** A provider circuit as the app shows it. */
export type CircuitState = "closed" | "open" | "half-open"
/** A workflow's status. */
export type WorkflowStatus = "defined" | "running" | "blocked" | "paused" | "stopping" | "stopped" | "done"
/** A graph node's state. */
export type NodeState = "waiting" | "ready" | "blocked" | "queued" | "running" | "launch-unknown" | "lost" | "reported" | "returned" | "verifying" | "done" | "failed" | "cancelled"
/** The role of a seat. */
export type SeatRole = "supervisor" | "kernel" | "worker"
/** A seat's liveness as the app shows it. */
export type Liveness = "alive" | "stalled" | "absent" | "closed" | "unknown"
/** A check's trust tier. */
export type TrustTier = "T0" | "T1" | "T2"
/** A check's state on the newest attempt. */
export type CheckState = "pending" | "green" | "red"

/** An agent, its model and effort. */
export interface Member {
    readonly agent: string
    readonly model: string
    readonly effort: string | null
}

/** One quota window of a provider. */
export interface QuotaWindow {
    readonly label: string
    readonly usedPercent: number
    readonly resetsAt: string | null
}

/** One provider: circuit, windows, running workers and cap. */
export interface ProviderStatus {
    readonly provider: ProviderId
    readonly circuit: CircuitState
    readonly failureKind: string | null
    readonly reopensAt: string | null
    readonly windows: readonly QuotaWindow[]
    readonly running: readonly { readonly model: string; readonly count: number }[]
    readonly cap: number
}

/** One project with its Supervisor and the owner decisions it waits on. */
export interface ProjectSummary {
    readonly key: string
    readonly name: string
    readonly supervisor: { readonly member: Member; readonly liveness: Liveness; readonly terminal: string | null } | null
    readonly openOwnerDecisions: number
}

/** One workflow on the overview. */
export interface WorkflowRow {
    readonly project: string
    readonly id: string
    readonly goalSummary: string
    readonly status: WorkflowStatus
    readonly reason: string | null
    readonly done: number
    readonly total: number
    readonly liveOps: number
    readonly parallelCap: number
    readonly kernel: Member | null
    readonly awaitingOwner: boolean
}

/** One line of the overview's event feed. */
export interface EventRow {
    readonly at: string
    readonly project: string
    readonly text: string
    readonly attention: boolean
}

/** Screen 1: projects, providers, workflows, events and the host driver. */
export interface Overview {
    readonly projects: readonly ProjectSummary[]
    readonly providers: readonly ProviderStatus[]
    readonly workflows: readonly WorkflowRow[]
    readonly events: readonly EventRow[]
    readonly host: { readonly watch: boolean; readonly tick: number; readonly lastTickAt: string | null }
}

/** One node of a workflow graph. */
export interface GraphNode {
    readonly key: string
    readonly title: string
    readonly label: string
    readonly state: NodeState
    readonly task: string | null
    readonly member: Member | null
    readonly startedAt: string | null
    readonly dependsOn: readonly string[]
    readonly record: string | null
    readonly side: "be" | "fe" | null
    readonly why: string | null
}

/** One seat of a workflow's tree. */
export interface Seat {
    readonly id: string
    readonly role: SeatRole
    readonly title: string
    readonly member: Member
    readonly liveness: Liveness
    readonly task: string | null
}

/** Screen 2: one workflow. */
export interface WorkflowDetail {
    readonly project: string
    readonly id: string
    readonly goal: { readonly version: number; readonly text: string }
    readonly graphVersion: number
    readonly status: WorkflowStatus
    readonly reason: string | null
    readonly nodes: readonly GraphNode[]
    readonly flow: readonly string[]
    readonly flowProblems: readonly string[]
    readonly seats: readonly Seat[]
    readonly parallel: { readonly live: number; readonly cap: number; readonly queued: number }
}

/** One check of a task's contract. */
export interface Check {
    readonly name: string
    readonly tier: TrustTier
    readonly state: CheckState
    readonly detail: string | null
}

/** One step of the router's decision. */
export interface RouteStep {
    readonly step: string
    readonly detail: string
}

/** One attempt of a task. */
export interface Attempt {
    readonly n: number
    readonly member: Member
    readonly outcome: string
    readonly at: string
}

/** Screen 3: one task. */
export interface TaskDetail {
    readonly project: string
    readonly workflow: string
    readonly id: string
    readonly key: string
    readonly label: string
    readonly title: string
    readonly state: NodeState
    readonly contract: { readonly summary: string; readonly allowPaths: readonly string[]; readonly dependsOn: readonly string[]; readonly record: string | null; readonly step: string | null }
    readonly checks: readonly Check[]
    readonly route: { readonly tier: string; readonly steps: readonly RouteStep[]; readonly chosen: Member; readonly by: string }
    readonly attempts: readonly Attempt[]
    readonly terminalTail: readonly string[]
    readonly terminal: string | null
}

/** One option of a decision. */
export interface DecisionOption {
    readonly id: string
    readonly title: string
    readonly detail: string
}

/** Screen 4: one decision awaiting the owner. */
export interface Decision {
    readonly project: string
    readonly id: string
    readonly kind: "owner" | "harness"
    readonly workflow: string
    readonly title: string
    readonly body: string
    readonly options: readonly DecisionOption[]
    readonly raisedAt: string
    readonly askedBy: string
    /** The harness CLI command the ruling becomes, so the owner sees what will run. */
    readonly command: string
}

/** The owner's answer to a decision. */
export interface Ruling {
    readonly option: string | null
    readonly note: string
}

/** A workflow's next goal text. */
export interface GoalSet {
    readonly text: string
}

/** Screen 5: one harness setting. */
export interface ConfigEntry {
    readonly key: string
    readonly file: string
    readonly value: unknown
}

/** A setting to change. */
export interface ConfigSet {
    readonly key: string
    readonly value: unknown
}

/** What a write did: ok, or the refusal code and message. */
export interface ActionResult {
    readonly ok: boolean
    readonly code: string | null
    readonly message: string
}

/** One change the event stream announces. */
export type LiveEvent =
    | { readonly type: "overview" }
    | { readonly type: "workflow"; readonly project: string; readonly workflow: string }
    | { readonly type: "task"; readonly project: string; readonly task: string }
    | { readonly type: "inbox" }
    | { readonly type: "config" }
