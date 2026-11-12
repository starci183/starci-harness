/**
 * Realistic fixtures of every contract type, taken from the mockup (the 2026-10-27 state of three projects). `?fixtures=1`
 * serves them in place of `starci ui`, so the app and every page run with no server.
 */
import type {
    ActionResult,
    ConfigEntry,
    Decision,
    GraphNode,
    Member,
    OwnerRequestRow,
    Overview,
    Seat,
    TaskDetail,
    WorkflowDetail,
} from "@contract"

const at = (time: string): string => `2026-10-27T${time}:00+07:00`

const opus: Member = { agent: "claude", model: "claude-opus-5-5", effort: "high" }
const sonnet: Member = { agent: "claude", model: "claude-sonnet-5-5", effort: "medium" }
const sol: Member = { agent: "codex", model: "gpt-6.1-sol", effort: "high" }
const luna: Member = { agent: "codex", model: "gpt-6-luna", effort: "medium" }
const swe: Member = { agent: "devin", model: "swe-2-max", effort: null }

export const fixtureOverview: Overview = {
    projects: [
        {
            key: "demo-app",
            name: "demo-app",
            supervisor: { member: opus, liveness: "alive", terminal: "term_51c0e2" },
            openOwnerDecisions: 1,
        },
        {
            key: "demo-lib",
            name: "demo-lib",
            supervisor: { member: sol, liveness: "stalled", terminal: "term_7d19aa" },
            openOwnerDecisions: 1,
        },
        {
            key: "demo-app-fe",
            name: "demo-app-fe",
            supervisor: { member: opus, liveness: "alive", terminal: "term_0b44f1" },
            openOwnerDecisions: 0,
        },
    ],
    providers: [
        {
            provider: "claude",
            circuit: "closed",
            failureKind: null,
            reopensAt: null,
            windows: [
                { label: "5h", usedPercent: 2, resetsAt: at("15:00") },
                { label: "week", usedPercent: 50, resetsAt: "2026-10-30T15:00:00+07:00" },
            ],
            running: [
                { model: "opus", count: 3 },
                { model: "sonnet", count: 4 },
            ],
            cap: 6,
        },
        {
            provider: "codex",
            circuit: "closed",
            failureKind: null,
            reopensAt: null,
            windows: [{ label: "week", usedPercent: 82, resetsAt: "2026-11-02T06:44:00+07:00" }],
            running: [
                { model: "sol", count: 5 },
                { model: "luna", count: 2 },
            ],
            cap: 10,
        },
        {
            provider: "devin",
            circuit: "closed",
            failureKind: null,
            reopensAt: null,
            windows: [{ label: "ACU month", usedPercent: 31, resetsAt: "2026-11-01T00:00:00+07:00" }],
            running: [{ model: "swe-2-max", count: 0 }],
            cap: 4,
        },
        {
            provider: "cursor",
            circuit: "open",
            failureKind: "quota-exhausted",
            reopensAt: "2026-11-21T00:00:00+07:00",
            windows: [{ label: "month", usedPercent: 100, resetsAt: "2026-11-21T00:00:00+07:00" }],
            running: [{ model: "auto", count: 0 }],
            cap: 10,
        },
    ],
    workflows: [
        {
            project: "demo-app",
            id: "add-search",
            goalSummary: "Search across items; BE then FE",
            status: "running",
            reason: null,
            done: 5,
            total: 22,
            liveOps: 7,
            parallelCap: 10,
            kernel: opus,
            awaitingOwner: false,
        },
        {
            project: "demo-app",
            id: "w1-be",
            goalSummary: "Pagination for item lists",
            status: "blocked",
            reason: "fixture-canon",
            done: 7,
            total: 8,
            liveOps: 0,
            parallelCap: 10,
            kernel: opus,
            awaitingOwner: false,
        },
        {
            project: "demo-lib",
            id: "publish-lib-release",
            goalSummary: "Grammar core cohort",
            status: "blocked",
            reason: "publish core cohort",
            done: 8,
            total: 10,
            liveOps: 0,
            parallelCap: 10,
            kernel: sol,
            awaitingOwner: true,
        },
        {
            project: "demo-app",
            id: "uat-sign-in",
            goalSummary: "UAT sign-in",
            status: "defined",
            reason: null,
            done: 0,
            total: 1,
            liveOps: 0,
            parallelCap: 10,
            kernel: null,
            awaitingOwner: false,
        },
    ],
    events: [
        {
            at: at("12:43"),
            project: "demo-app",
            text: "Kernel add-search launch → claude/claude-opus-5-5 (score 0.50, balance)",
            attention: false,
        },
        { at: at("12:41"), project: "demo-app", text: "Op t-55ca2c6b docs → green · 4 checks T0", attention: false },
        {
            at: at("12:38"),
            project: "demo-app",
            text: "d-6979996fe691 ruled by owner → goal v27 (BE + FE in one workflow)",
            attention: false,
        },
        { at: at("12:34"), project: "demo-lib", text: "d-c11 escalation owner: publish lib release 1.2.0", attention: true },
    ],
    host: { version: "0.1.0", watch: true, tick: 51, lastTickAt: at("12:44") },
}

const node = (
    key: string,
    title: string,
    label: string,
    state: GraphNode["state"],
    extra: Partial<Omit<GraphNode, "key" | "title" | "label" | "state">> = {},
): GraphNode => ({
    key,
    title,
    label,
    state,
    task: null,
    member: null,
    startedAt: null,
    dependsOn: [],
    record: "impl.search.api",
    side: "be",
    why: null,
    ...extra,
})

const feRecord = "impl.search.demo-app-fe.ui"

const searchNodes: readonly GraphNode[] = [
    node("D1", "spec search", "docs", "done", { task: "t-55ca2c6b", member: sonnet, side: null }),
    node("D2", "spec search box UI", "docs", "done", { task: "t-5e01aa90", member: luna, side: "fe", record: feRecord }),
    node("G0", "baseline gates", "code", "done", { task: "t-0c9b7710", member: sol, side: null }),
    node("B1", "B1 index entity + migration", "code", "done", { task: "t-b1f20c33", member: sonnet, dependsOn: ["D1", "G0"] }),
    node("B2", "B2 Add search index", "code", "running", {
        task: "t-b2c41e07",
        member: sonnet,
        startedAt: at("12:38"),
        dependsOn: ["B1"],
    }),
    node("B3", "B3 Search API", "code", "running", {
        task: "t-b3d9e1a4",
        member: opus,
        startedAt: at("12:35"),
        dependsOn: ["B1"],
    }),
    node("B4", "B4 ranking adapter", "code", "running", {
        task: "t-b4a71c58",
        member: luna,
        startedAt: at("12:40"),
        dependsOn: ["B1"],
    }),
    node("B5", "B5 access guard", "code", "running", {
        task: "t-b5e8f902",
        member: swe,
        startedAt: at("12:41"),
        dependsOn: ["B1"],
    }),
    node("B6", "B6 reindex cron", "code", "blocked", {
        task: "t-b6f3a017",
        dependsOn: ["B1"],
        why: "route retry 1/2",
    }),
    node("T2", "T2–T6 test BE ×5", "test", "waiting", { dependsOn: ["B2", "B3", "B4", "B5", "B6"], why: "waits for B2–B6" }),
    node("F1", "F1 Search box UI", "code", "waiting", {
        dependsOn: ["B2", "D2"],
        side: "fe",
        record: feRecord,
        why: "waits for B2 + UI design",
    }),
    node("F2", "F2 Results list", "code", "waiting", {
        dependsOn: ["B3", "B4"],
        side: "fe",
        record: feRecord,
        why: "waits for B3, B4",
    }),
    node("F3", "F3 Filter badge", "code", "waiting", { dependsOn: ["B5"], side: "fe", record: feRecord, why: "waits for B5" }),
    node("E1", "E1 e2e search", "verify", "waiting", { dependsOn: ["T2"], why: "waits for T*" }),
    node("L1", "L1 Index live check", "verify", "waiting", { dependsOn: ["B3"], why: "integration" }),
    node("A1", "A1–A3 audit FE", "audit", "waiting", {
        dependsOn: ["F1", "F2", "F3"],
        side: "fe",
        record: feRecord,
        why: "waits for F1–F3",
    }),
    node("R1", "R1 review BE", "review", "waiting", { dependsOn: ["E1", "L1"], why: "reviewer differs from author" }),
    node("U1", "U1 UAT search", "uat", "waiting", {
        dependsOn: ["A1", "R1"],
        side: "fe",
        record: feRecord,
        why: "receipted run",
    }),
    node("X1", "D1 deliver", "deliver", "waiting", { dependsOn: ["U1"], side: null, why: "handoff → Supervisor" }),
]

const searchSeats: readonly Seat[] = [
    {
        id: "seat-sup-demo-app",
        role: "supervisor",
        title: "[Supervisor] demo-app",
        member: opus,
        liveness: "alive",
        task: null,
    },
    {
        id: "seat-kernel-search",
        role: "kernel",
        title: "[Kernel] add-search",
        member: opus,
        liveness: "alive",
        task: null,
    },
    { id: "seat-op-b2", role: "worker", title: "[Op] code (t-b2c41e07)", member: sonnet, liveness: "alive", task: "t-b2c41e07" },
    { id: "seat-op-b3", role: "worker", title: "[Op] code (t-b3d9e1a4)", member: opus, liveness: "alive", task: "t-b3d9e1a4" },
    { id: "seat-op-b4", role: "worker", title: "[Op] code (t-b4a71c58)", member: luna, liveness: "alive", task: "t-b4a71c58" },
    { id: "seat-op-b5", role: "worker", title: "[Op] code (t-b5e8f902)", member: swe, liveness: "stalled", task: "t-b5e8f902" },
]

const searchWorkflow: WorkflowDetail = {
    project: "demo-app",
    id: "add-search",
    goal: {
        version: 27,
        text: "Search across items; BE and FE in one workflow, each FE code step waits for the BE code step of the same feature.",
    },
    graphVersion: 15,
    status: "running",
    reason: null,
    nodes: searchNodes,
    flow: [
        "impl.search.api [impl-be]: code carried · test missing→T2 · e2e · review",
        "impl.search.demo-app-fe.ui [impl-fe]: code held until impl-be code · audit · uat",
    ],
    flowProblems: [],
    seats: searchSeats,
    parallel: { live: 7, cap: 10, queued: 0 },
}

/** The detail of any workflow; ids other than the mockup's answer from its row with the same graph shape. */
export const fixtureWorkflow = (project: string, workflow: string): WorkflowDetail => {
    if (project === searchWorkflow.project && workflow === searchWorkflow.id) return searchWorkflow
    const row = fixtureOverview.workflows.find(candidate => candidate.project === project && candidate.id === workflow)
    return {
        ...searchWorkflow,
        project,
        id: workflow,
        goal: { version: 1, text: row?.goalSummary ?? workflow },
        graphVersion: 1,
        status: row?.status ?? "defined",
        reason: row?.reason ?? null,
        parallel: { live: row?.liveOps ?? 0, cap: row?.parallelCap ?? 10, queued: 0 },
        flowProblems: row?.status === "blocked" ? [row.reason ?? "blocked"] : [],
    }
}

const b2Task: TaskDetail = {
    project: "demo-app",
    workflow: "add-search",
    id: "t-b2c41e07",
    key: "B2",
    label: "code",
    title: "B2 Add search index",
    state: "running",
    contract: {
        summary:
            "Add a search index over items with a 250 ms debounce window. Seed the `search_index` table, query `search` returns ranked hits and totals.",
        allowPaths: ["src/modules/search/index/**", "src/migrations/*-search-index.ts"],
        dependsOn: ["B1"],
        record: "impl.search.api",
        step: "code",
    },
    checks: [
        { name: "paths-only", tier: "T0", state: "pending", detail: "waits for submit" },
        { name: "typecheck · lint · build", tier: "T0", state: "pending", detail: "waits for submit" },
        { name: "loosening · secrets", tier: "T0", state: "pending", detail: "waits for submit" },
    ],
    route: {
        tier: "medium",
        steps: [
            { step: "hard-filter", detail: "5 members (cursor dropped: quota exhausted)" },
            { step: "quota", detail: "claude 50%, codex 82%, devin 31%" },
            { step: "lineage", detail: "nobody demoted" },
            { step: "score", detail: "sonnet 8.67 · luna 1.73 · swe-2-max 1.20" },
            { step: "balance", detail: "keep sonnet" },
        ],
        chosen: sonnet,
        by: "score",
    },
    attempts: [{ n: 1, member: sonnet, outcome: "running", at: at("12:38") }],
    terminalTail: [
        "● Reading src/modules/search/entity/index.entity.ts",
        "● Writing src/modules/search/index/index.seed.ts",
        "● Running npm run typecheck … ok",
    ],
    terminal: "term_8a1f3c90",
}

/** The detail of any task; ids other than the mockup's answer from the matching graph node. */
export const fixtureTask = (project: string, task: string): TaskDetail => {
    if (project === b2Task.project && task === b2Task.id) return b2Task
    const found = searchNodes.find(candidate => candidate.task === task)
    if (found === undefined) return { ...b2Task, project, id: task }
    const done = found.state === "done"
    return {
        ...b2Task,
        project,
        id: task,
        key: found.key,
        label: found.label,
        title: found.title,
        state: found.state,
        contract: { ...b2Task.contract, dependsOn: found.dependsOn, record: found.record, step: found.label },
        checks: b2Task.checks.map(check => (done ? { ...check, state: "green", detail: null } : check)),
        route: { ...b2Task.route, chosen: found.member ?? b2Task.route.chosen },
        attempts: found.member === null ? [] : [{ n: 1, member: found.member, outcome: found.state, at: found.startedAt ?? at("12:30") }],
        terminalTail: done ? ["● Submitted · checks green"] : b2Task.terminalTail,
    }
}

export const fixtureInbox: readonly Decision[] = [
    {
        project: "demo-app",
        id: "d-6979996fe691",
        kind: "harness",
        workflow: "add-search",
        title: "Kernel could not apply graph v15",
        body:
            "**Problem.** Flow check rejected FLOW_INCOMPLETE: FE record `impl.search.demo-app-fe.ui` lacks code, audit, uat in this workflow.\n\n" +
            "**State.** Graph v14 is intact, 3 tasks done, 2 running. No product code changed.",
        options: [
            {
                id: "1",
                title: "BE + FE in one workflow, FE waits for BE code",
                detail: "Kernel adds an FE lane, each FE code step depends on the BE code step of the same feature; up to 10 in parallel.",
            },
            { id: "2", title: "Send Debug to fix the harness", detail: "Kernel runs only the v14 tasks until the fix lands." },
            { id: "3", title: "Pause workflow", detail: "" },
        ],
        raisedAt: at("12:32"),
        askedBy: "[Supervisor] demo-app",
        command: "starci supervisor submit \"/path/to/harness/projects/demo-app/owner-commands/d-6979996fe691.json\" --cwd \"/path/to/demo-app\"",
    },
    {
        project: "demo-lib",
        id: "d-c1106437",
        kind: "owner",
        workflow: "publish-lib-release",
        title: "Publish lib 1.2.0 + hfs 4.7.48",
        body:
            "**Problem.** The workflow needs `demo-lib` 1.2.0 and hfs 4.7.48 published to npm; publishing is the project owner's decision.\n\n" +
            "**State.** 8/10 tasks done, build and gates green on the release branch; nothing is published yet.",
        options: [
            { id: "publish", title: "Publish both", detail: "Supervisor runs the publish, then Kernel continues the two consume tasks." },
            { id: "hold", title: "Hold", detail: "The workflow stays blocked until a new ruling." },
        ],
        raisedAt: "2026-10-27T10:44:00+07:00",
        askedBy: "[Supervisor] demo-lib",
        command: "starci supervisor submit \"/path/to/harness/projects/demo-lib/owner-commands/d-c1106437.json\" --cwd \"/path/to/demo-lib\"",
    },
]

export const fixtureConfig: readonly ConfigEntry[] = [
    { key: "routing.tiers.frontier.members", file: "ops/routing.yaml", value: ["claude-opus-5-5", "gpt-6.1-sol"] },
    { key: "routing.tiers.frontier.effort", file: "ops/routing.yaml", value: "max" },
    { key: "routing.tiers.high.members", file: "ops/routing.yaml", value: ["claude-opus-5-5", "gpt-6.1-sol"] },
    { key: "routing.tiers.high.effort", file: "ops/routing.yaml", value: "high" },
    {
        key: "routing.tiers.medium.members",
        file: "ops/routing.yaml",
        value: ["claude-sonnet-5-5", "swe-2-max", "gpt-6-luna", "cursor auto"],
    },
    { key: "routing.tiers.medium.effort", file: "ops/routing.yaml", value: "medium" },
    { key: "routing.tiers.low.members", file: "ops/routing.yaml", value: ["claude-sonnet-5-5", "swe-2-max", "gpt-6-luna"] },
    { key: "routing.tiers.low.effort", file: "ops/routing.yaml", value: "low" },
    { key: "routing.workflowParallel", file: "ops/routing.yaml", value: 10 },
    { key: "routing.pools.claude.maxParallel", file: "ops/routing.yaml", value: 6 },
    { key: "routing.pools.codex.maxParallel", file: "ops/routing.yaml", value: 10 },
    { key: "routing.pools.devin.maxParallel", file: "ops/routing.yaml", value: 4 },
    { key: "routing.pools.cursor.maxParallel", file: "ops/routing.yaml", value: 10 },
    { key: "lanes.impl-be.steps", file: "ops/lanes.yaml", value: ["code", "test", "e2e", "review"] },
    { key: "lanes.impl-fe.steps", file: "ops/lanes.yaml", value: ["code", "audit", "uat"] },
    { key: "stall.silentMinutes", file: "ops/stall.yaml", value: 12 },
    { key: "stall.launchTimeoutSeconds", file: "ops/stall.yaml", value: 90 },
    { key: "host.watch", file: "ops/host.yaml", value: true },
    { key: "host.tickSeconds", file: "ops/host.yaml", value: 60 },
]

/** What a write answers in fixtures mode: accepted, nothing changed on disk. */
export const fixtureAction = (what: string): ActionResult => ({
    ok: true,
    code: null,
    message: `Sample data: ${what} was accepted, nothing changed.`,
})

export const fixtureOwnerRequests: readonly OwnerRequestRow[] = [
    { id: "r-0214a7c3b9e1", project: "demo-app", text: "Start workflow uat-sign-in after auth-sign-in is done.", at: at("12:38"), status: "open", cmdId: null },
    { id: "r-09c1e5d27f40", project: "demo-lib", text: "Kernels back to Claude.", at: at("09:10"), status: "closed", cmdId: "c-4f1a82d0" },
]
