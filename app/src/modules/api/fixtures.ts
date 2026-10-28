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
            key: "starci-next",
            name: "starci-next",
            supervisor: { member: opus, liveness: "alive", terminal: "term_51c0e2" },
            openOwnerDecisions: 1,
        },
        {
            key: "nivo-lite",
            name: "nivo-lite",
            supervisor: { member: sol, liveness: "stalled", terminal: "term_7d19aa" },
            openOwnerDecisions: 1,
        },
        {
            key: "starci-next-fe",
            name: "starci-next-fe",
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
                { label: "tuần", usedPercent: 50, resetsAt: "2026-10-30T15:00:00+07:00" },
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
            windows: [{ label: "tuần", usedPercent: 82, resetsAt: "2026-11-02T06:44:00+07:00" }],
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
            windows: [{ label: "ACU tháng", usedPercent: 31, resetsAt: "2026-11-01T00:00:00+07:00" }],
            running: [{ model: "swe-2-max", count: 0 }],
            cap: 4,
        },
        {
            provider: "cursor",
            circuit: "open",
            failureKind: "quota-exhausted",
            reopensAt: "2026-11-21T00:00:00+07:00",
            windows: [{ label: "tháng", usedPercent: 100, resetsAt: "2026-11-21T00:00:00+07:00" }],
            running: [{ model: "auto", count: 0 }],
            cap: 10,
        },
    ],
    workflows: [
        {
            project: "starci-next",
            id: "next-subscription-sepay",
            goalSummary: "Premium tháng/năm · SePay + PayOS · BE → FE",
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
            project: "starci-next",
            id: "w1-be",
            goalSummary: "Học phần tương tác với AI",
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
            project: "nivo-lite",
            id: "nivo-standard-fix-orca",
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
            project: "starci-next",
            id: "next-uat-sign-in",
            goalSummary: "UAT đăng nhập",
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
            project: "starci-next",
            text: "Kernel next-subscription-sepay launch → claude/claude-opus-5-5 (score 0.50, balance)",
            attention: false,
        },
        { at: at("12:41"), project: "starci-next", text: "Op t-55ca2c6b docs → green · 4 checks T0", attention: false },
        {
            at: at("12:38"),
            project: "starci-next",
            text: "d-6979996fe691 ruled by owner → goal v27 (BE + FE một workflow)",
            attention: false,
        },
        { at: at("12:34"), project: "nivo-lite", text: "d-c11 escalation owner: publish core cohort 0.12.15", attention: true },
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
    record: "impl.commerce.subscription",
    side: "be",
    why: null,
    ...extra,
})

const feRecord = "impl.commerce.starci-next-fe.subscription"

const subscriptionNodes: readonly GraphNode[] = [
    node("D1", "spec subscription", "docs", "done", { task: "t-55ca2c6b", member: sonnet, side: null }),
    node("D2", "spec FE mua gói", "docs", "done", { task: "t-5e01aa90", member: luna, side: "fe", record: feRecord }),
    node("G0", "baseline gates", "code", "done", { task: "t-0c9b7710", member: sol, side: null }),
    node("B1", "B1 entity + migration", "code", "done", { task: "t-b1f20c33", member: sonnet, dependsOn: ["D1", "G0"] }),
    node("B2", "B2 bảng giá tháng/năm", "code", "running", {
        task: "t-b2c41e07",
        member: sonnet,
        startedAt: at("12:38"),
        dependsOn: ["B1"],
    }),
    node("B3", "B3 adapter SePay", "code", "running", {
        task: "t-b3d9e1a4",
        member: opus,
        startedAt: at("12:35"),
        dependsOn: ["B1"],
    }),
    node("B4", "B4 adapter PayOS", "code", "running", {
        task: "t-b4a71c58",
        member: luna,
        startedAt: at("12:40"),
        dependsOn: ["B1"],
    }),
    node("B5", "B5 entitlement guard", "code", "running", {
        task: "t-b5e8f902",
        member: swe,
        startedAt: at("12:41"),
        dependsOn: ["B1"],
    }),
    node("B6", "B6 cron gia hạn", "code", "blocked", {
        task: "t-b6f3a017",
        dependsOn: ["B1"],
        why: "route retry 1/2",
    }),
    node("T2", "T2–T6 test BE ×5", "test", "waiting", { dependsOn: ["B2", "B3", "B4", "B5", "B6"], why: "chờ B2–B6" }),
    node("F1", "F1 chọn gói", "code", "waiting", {
        dependsOn: ["B2", "D2"],
        side: "fe",
        record: feRecord,
        why: "chờ B2 + ui vẽ xong",
    }),
    node("F2", "F2 thanh toán QR", "code", "waiting", {
        dependsOn: ["B3", "B4"],
        side: "fe",
        record: feRecord,
        why: "chờ B3, B4",
    }),
    node("F3", "F3 badge Premium", "code", "waiting", { dependsOn: ["B5"], side: "fe", record: feRecord, why: "chờ B5" }),
    node("E1", "E1 e2e thanh toán", "verify", "waiting", { dependsOn: ["T2"], why: "chờ T*" }),
    node("L1", "L1 SePay live check", "verify", "waiting", { dependsOn: ["B3"], why: "integration" }),
    node("A1", "A1–A3 audit FE", "audit", "waiting", {
        dependsOn: ["F1", "F2", "F3"],
        side: "fe",
        record: feRecord,
        why: "chờ F1–F3",
    }),
    node("R1", "R1 review BE", "review", "waiting", { dependsOn: ["E1", "L1"], why: "reviewer khác tác giả" }),
    node("U1", "U1 UAT mua gói", "uat", "waiting", {
        dependsOn: ["A1", "R1"],
        side: "fe",
        record: feRecord,
        why: "receipted run",
    }),
    node("X1", "D1 deliver", "deliver", "waiting", { dependsOn: ["U1"], side: null, why: "handoff → Supervisor" }),
]

const subscriptionSeats: readonly Seat[] = [
    {
        id: "seat-sup-starci-next",
        role: "supervisor",
        title: "[Supervisor] starci-next",
        member: opus,
        liveness: "alive",
        task: null,
    },
    {
        id: "seat-kernel-sub",
        role: "kernel",
        title: "[Kernel] next-subscription-sepay",
        member: opus,
        liveness: "alive",
        task: null,
    },
    { id: "seat-op-b2", role: "worker", title: "[Op] code (t-b2c41e07)", member: sonnet, liveness: "alive", task: "t-b2c41e07" },
    { id: "seat-op-b3", role: "worker", title: "[Op] code (t-b3d9e1a4)", member: opus, liveness: "alive", task: "t-b3d9e1a4" },
    { id: "seat-op-b4", role: "worker", title: "[Op] code (t-b4a71c58)", member: luna, liveness: "alive", task: "t-b4a71c58" },
    { id: "seat-op-b5", role: "worker", title: "[Op] code (t-b5e8f902)", member: swe, liveness: "stalled", task: "t-b5e8f902" },
]

const subscriptionWorkflow: WorkflowDetail = {
    project: "starci-next",
    id: "next-subscription-sepay",
    goal: {
        version: 27,
        text: "Gói Premium tháng và năm, thanh toán qua SePay và PayOS; BE và FE trong một workflow, mỗi code FE chờ code BE cùng tính năng.",
    },
    graphVersion: 15,
    status: "running",
    reason: null,
    nodes: subscriptionNodes,
    flow: [
        "impl.commerce.subscription [impl-be]: code carried · test missing→T2 · e2e · review",
        "impl.commerce.starci-next-fe.subscription [impl-fe]: code held until impl-be code · audit · uat",
    ],
    flowProblems: [],
    seats: subscriptionSeats,
    parallel: { live: 7, cap: 10, queued: 0 },
}

/** The detail of any workflow; ids other than the mockup's answer from its row with the same graph shape. */
export const fixtureWorkflow = (project: string, workflow: string): WorkflowDetail => {
    if (project === subscriptionWorkflow.project && workflow === subscriptionWorkflow.id) return subscriptionWorkflow
    const row = fixtureOverview.workflows.find(candidate => candidate.project === project && candidate.id === workflow)
    return {
        ...subscriptionWorkflow,
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
    project: "starci-next",
    workflow: "next-subscription-sepay",
    id: "t-b2c41e07",
    key: "B2",
    label: "code",
    title: "B2 bảng giá tháng/năm",
    state: "running",
    contract: {
        summary:
            "Thêm gói Premium tháng 229.000đ và năm 2.290.000đ (bằng 10 tháng). Seed bảng `plan`, query `plans` trả giá và chu kỳ.",
        allowPaths: ["src/modules/subscription/plan/**", "src/migrations/*-plan.ts"],
        dependsOn: ["B1"],
        record: "impl.commerce.subscription",
        step: "code",
    },
    checks: [
        { name: "paths-only", tier: "T0", state: "pending", detail: "chờ submit" },
        { name: "typecheck · lint · build", tier: "T0", state: "pending", detail: "chờ submit" },
        { name: "loosening · secrets", tier: "T0", state: "pending", detail: "chờ submit" },
    ],
    route: {
        tier: "medium",
        steps: [
            { step: "hard-filter", detail: "5 member (cursor bị loại: hết quota)" },
            { step: "quota", detail: "claude 50%, codex 82%, devin 31%" },
            { step: "lineage", detail: "không ai bị demote" },
            { step: "score", detail: "sonnet 8.67 · luna 1.73 · swe-2-max 1.20" },
            { step: "balance", detail: "giữ sonnet" },
        ],
        chosen: sonnet,
        by: "score",
    },
    attempts: [{ n: 1, member: sonnet, outcome: "running", at: at("12:38") }],
    terminalTail: [
        "● Reading src/modules/subscription/entity/plan.entity.ts",
        "● Writing src/modules/subscription/plan/plan.seed.ts",
        "● Running npm run typecheck … ok",
    ],
    terminal: "term_8a1f3c90",
}

/** The detail of any task; ids other than the mockup's answer from the matching graph node. */
export const fixtureTask = (project: string, task: string): TaskDetail => {
    if (project === b2Task.project && task === b2Task.id) return b2Task
    const found = subscriptionNodes.find(candidate => candidate.task === task)
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
        project: "starci-next",
        id: "d-6979996fe691",
        kind: "harness",
        workflow: "next-subscription-sepay",
        title: "Kernel không áp được graph v15",
        body:
            "**Vấn đề.** Flow check từ chối FLOW_INCOMPLETE: record FE `impl.commerce.starci-next-fe.subscription` thiếu code, audit, uat trong workflow này.\n\n" +
            "**Hiện trạng.** Graph v14 còn nguyên, 3 task xong, 2 đang chạy. Không có code sản phẩm nào bị đổi.",
        options: [
            {
                id: "1",
                title: "BE + FE một workflow, FE chờ code BE",
                detail: "Kernel thêm lane FE, mỗi code FE phụ thuộc code BE cùng tính năng; song song tối đa 10.",
            },
            { id: "2", title: "Gửi Debug sửa harness", detail: "Kernel chỉ chạy các task v14 cho tới khi fix vào." },
            { id: "3", title: "Pause workflow", detail: "" },
        ],
        raisedAt: at("12:32"),
        askedBy: "[Supervisor] starci-next",
        command: "starci supervisor submit --project starci-next --answer d-6979996fe691",
    },
    {
        project: "nivo-lite",
        id: "d-c1106437",
        kind: "owner",
        workflow: "nivo-standard-fix-orca",
        title: "Publish core cohort 0.12.15 + hfs 4.7.48",
        body:
            "**Vấn đề.** Workflow cần publish `@starci/grammar` 0.12.15 (core cohort) và hfs 4.7.48 lên npm; publish là quyết định của chủ dự án.\n\n" +
            "**Hiện trạng.** 8/10 task xong, build và gate xanh trên nhánh cohort; chưa có gì được publish.",
        options: [
            { id: "publish", title: "Publish cả hai", detail: "Supervisor chạy publish rồi Kernel tiếp hai task consume." },
            { id: "hold", title: "Giữ lại", detail: "Workflow dừng ở trạng thái blocked cho tới ruling mới." },
        ],
        raisedAt: "2026-10-27T10:44:00+07:00",
        askedBy: "[Supervisor] nivo-lite",
        command: "starci supervisor submit --project nivo-lite --answer d-c1106437",
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
    message: `Dữ liệu mẫu: ${what} được ghi nhận, không có gì thay đổi.`,
})

export const fixtureOwnerRequests: readonly OwnerRequestRow[] = [
    { id: "r-0214a7c3b9e1", project: "starci-next", text: "Start workflow uat-sign-in sau khi auth-sign-in xong.", at: at("12:38"), status: "open", cmdId: null },
    { id: "r-09c1e5d27f40", project: "nivo-lite", text: "Kernels về Claude.", at: at("09:10"), status: "closed", cmdId: "c-4f1a82d0" },
]
