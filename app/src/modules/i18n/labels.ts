/**
 * Every status word, tone and piece of interface copy the app shows, in one place. Connected halves import from here and
 * hand pure halves the words; nothing else spells a status itself, so one state reads the same on every screen.
 *
 * Tones: `danger` is reserved for a real failure (a failed or lost Op, a red check, an absent Supervisor, an open
 * circuit). Work in progress is `accent`; something that needs a look is `warning`; finished is `success`; idle, waiting
 * and intentionally stopped are `neutral`. A state is a `StatusDot` chip (a dot and its words), a flag is a `Badge`, so
 * two side by side differ in shape as well as hue. Every label starts with an uppercase letter.
 */
import type { FlowGraphTone, PresentationState, StatusDotTone } from "@starci/grammar/core"
import type {
    CheckState,
    CircuitState,
    Decision,
    Liveness,
    NodeState,
    ProviderId,
    SeatRole,
    WorkflowStatus,
} from "@contract"

export const LOCALE = "vi"

export interface StatusLabel {
    readonly label: string
    readonly tone: StatusDotTone
}

/* ------------------------------------------------------------------ navigation and page titles */

export const NAV = {
    landmark: "Điều hướng",
    openDrawer: "Mở điều hướng",
    closeDrawer: "Đóng điều hướng",
    content: "Nội dung",
    product: "StarCi Harness",
    edition: "alpha.1",
    overview: "Tổng quan",
    workflows: "Workflows",
    inbox: "Cần quyết định",
    settings: "Cài đặt",
    projects: "Dự án",
    inboxBadge: (count: number) => `${count} quyết định đang chờ`,
} as const

/* ------------------------------------------------------------------ workflow status */

export const WORKFLOW_STATUS: Readonly<Record<WorkflowStatus, StatusLabel>> = {
    defined: { label: "Đã định nghĩa", tone: "neutral" },
    running: { label: "Đang chạy", tone: "accent" },
    blocked: { label: "Bị chặn", tone: "warning" },
    paused: { label: "Tạm dừng", tone: "neutral" },
    stopping: { label: "Đang dừng", tone: "warning" },
    stopped: { label: "Đã dừng", tone: "neutral" },
    done: { label: "Hoàn tất", tone: "success" },
}

/** The flag a workflow carries while an owner decision on it is open. A flag, not a state: a Badge, no dot. */
export const AWAITING_DECISION: StatusLabel = { label: "Cần quyết định", tone: "accent" }

/* ------------------------------------------------------------------ Op (graph node) state */

export interface NodeStateLabel extends StatusLabel {
    readonly graphTone: FlowGraphTone
    readonly presentation: PresentationState
    /** Not started yet: the graph draws it dashed. */
    readonly isPending: boolean
}

const node = (label: string, tone: StatusDotTone, graphTone: FlowGraphTone, presentation: PresentationState, isPending = false): NodeStateLabel => ({
    label,
    tone,
    graphTone,
    presentation,
    isPending,
})

export const NODE_STATE: Readonly<Record<NodeState, NodeStateLabel>> = {
    waiting: node("Chờ phụ thuộc", "neutral", "neutral", "neutral", true),
    ready: node("Sẵn sàng", "neutral", "neutral", "neutral", true),
    queued: node("Chờ lượt", "neutral", "neutral", "pending", true),
    blocked: node("Bị chặn", "warning", "warning", "cautionary"),
    running: node("Đang chạy", "accent", "accent", "informative"),
    "launch-unknown": node("Chưa xác nhận khởi chạy", "warning", "warning", "cautionary"),
    lost: node("Mất kết nối", "danger", "danger", "negative"),
    reported: node("Đã báo cáo", "accent", "accent", "informative"),
    returned: node("Bị trả lại", "warning", "warning", "cautionary"),
    verifying: node("Đang kiểm tra", "accent", "accent", "pending"),
    done: node("Hoàn tất", "success", "success", "affirmative"),
    failed: node("Thất bại", "danger", "danger", "negative"),
    cancelled: node("Đã huỷ", "neutral", "muted", "unavailable"),
}

/** The graph legend groups Op states the way the graph paints them. */
export const NODE_LEGEND: readonly StatusLabel[] = [
    { tone: "success", label: "Hoàn tất" },
    { tone: "accent", label: "Đang chạy, đang kiểm tra" },
    { tone: "neutral", label: "Chờ phụ thuộc, chờ lượt (nét đứt)" },
    { tone: "warning", label: "Bị chặn, bị trả lại" },
    { tone: "danger", label: "Thất bại, mất kết nối" },
]

/* ------------------------------------------------------------------ liveness */

export const SEAT_LIVENESS: Readonly<Record<Liveness, StatusLabel>> = {
    alive: { label: "Đang hoạt động", tone: "success" },
    stalled: { label: "Không phản hồi", tone: "warning" },
    absent: { label: "Vắng mặt", tone: "danger" },
    closed: { label: "Đã đóng", tone: "neutral" },
    unknown: { label: "Chưa rõ", tone: "neutral" },
}

/** A project's Supervisor as the sidebar dot names it (accessible name and tooltip); `null` is a project with no Supervisor seat. */
export const supervisorStatus = (liveness: Liveness | null): StatusLabel => {
    switch (liveness) {
        case null:
            return { label: "Không có Supervisor", tone: "neutral" }
        case "alive":
            return { label: "Supervisor đang hoạt động", tone: "success" }
        case "stalled":
            return { label: "Supervisor dừng", tone: "warning" }
        case "absent":
            return { label: "Supervisor dừng", tone: "danger" }
        case "closed":
            return { label: "Supervisor dừng", tone: "neutral" }
        case "unknown":
            return { label: "Chưa rõ trạng thái Supervisor", tone: "neutral" }
    }
}

export const SEAT_ROLE: Readonly<Record<SeatRole, string>> = { supervisor: "Supervisor", kernel: "Kernel", worker: "Op" }

/* ------------------------------------------------------------------ checks */

export const CHECK_STATE: Readonly<Record<CheckState, StatusLabel>> = {
    pending: { label: "Đang chờ", tone: "neutral" },
    green: { label: "Đạt", tone: "success" },
    red: { label: "Không đạt", tone: "danger" },
}

/* ------------------------------------------------------------------ providers */

export const PROVIDER_NAME: Readonly<Record<ProviderId, string>> = {
    claude: "Claude",
    codex: "Codex",
    devin: "Devin",
    cursor: "Cursor",
}

export interface CircuitLabel extends StatusLabel {
    readonly meter: PresentationState
}

export const CIRCUIT: Readonly<Record<CircuitState | "near-reserve" | "quota", CircuitLabel>> = {
    closed: { label: "Sẵn sàng", tone: "success", meter: "informative" },
    "near-reserve": { label: "Gần hạn mức", tone: "warning", meter: "cautionary" },
    "half-open": { label: "Đang thử lại", tone: "warning", meter: "cautionary" },
    open: { label: "Tạm ngắt", tone: "danger", meter: "negative" },
    quota: { label: "Hết hạn mức", tone: "danger", meter: "negative" },
}

/* ------------------------------------------------------------------ decisions */

export const DECISION_KIND: Readonly<Record<Decision["kind"], StatusLabel>> = {
    owner: { label: "Chủ dự án", tone: "neutral" },
    harness: { label: "Harness", tone: "neutral" },
}

/* ------------------------------------------------------------------ host and connection (sidebar footer) */

export type FooterConnection = "open" | "connecting" | "retrying" | "off" | "fixtures"

export const CONNECTION: Readonly<Record<FooterConnection, string>> = {
    open: "Trực tiếp",
    connecting: "Đang kết nối",
    retrying: "Đang kết nối lại",
    off: "Không cập nhật trực tiếp",
    fixtures: "Dữ liệu mẫu",
}

export const HOST = {
    watchOff: "Watch tắt",
    tick: (tick: number, at: string | null) => (at === null ? `Tick ${tick}` : `Tick ${tick} lúc ${at}`),
    noTick: "Chưa có tick",
} as const

/* ------------------------------------------------------------------ data status of a region (SlotView) */

export const SLOT = {
    forbidden: "Bạn không có quyền xem phần này",
    error: "Không tải được phần này",
    retry: "Thử lại",
} as const

/* ------------------------------------------------------------------ shared words */

export const COMMON = {
    none: "Không",
    unassigned: "Chưa giao",
    shared: "Chung",
    defaultEffort: "Mặc định",
    dismissNotice: "Đóng thông báo",
    close: "Đóng",
    cancel: "Huỷ",
    dash: "–",
    effort: (effort: string) => `effort ${effort}`,
    notifications: "Thông báo",
} as const

/* ------------------------------------------------------------------ Tổng quan */

export const OVERVIEW = {
    title: "Tổng quan",
    counts: (projects: number, active: number, live: number) => `${projects} dự án · ${active} workflow đang hoạt động · ${live} Op đang chạy`,
    newWorkflow: "Workflow mới",
    newWorkflowReason: "Tạo workflow từ app sẽ có ở bản sau; hiện dùng starci workflow trong terminal.",
    loadError: "Không tải được tổng quan",
    staleSuffix: "Đang hiện số liệu lần trước.",
    providersRegion: "Hạn mức nhà cung cấp",
    providersTitle: "Nhà cung cấp",
    providersFact: "Hạn mức và số Op đang chạy",
    providerSkeleton: (index: number) => `Nhà cung cấp ${index + 1}`,
    providerQuota: (name: string) => `Hạn mức ${name}`,
    noProviders: "Chưa có nhà cung cấp",
    noProvidersHint: "Harness chưa ghi trạng thái hạn mức của nhà cung cấp nào.",
    noQuota: "Chưa có số liệu hạn mức",
    reset: "Đặt lại",
    reopen: "Mở lại",
    running: (slots: string, cap: number) => `Đang chạy ${slots} · giới hạn ${cap}`,
    workflowsTitle: "Workflows",
    workflowsFact: "Supervisor mỗi dự án chạy ở main; Kernel mỗi workflow chạy ở worktree riêng.",
    noWorkflows: "Chưa có workflow nào",
    noWorkflowsHint: "Tạo workflow bằng starci workflow trong terminal; nó sẽ hiện ở đây.",
    columns: { workflow: "Workflow", project: "Dự án", status: "Trạng thái", progress: "Tiến độ", live: "Op đang chạy", kernel: "Kernel" },
    progressLabel: (id: string) => `Tiến độ ${id}`,
    progressValue: (done: number, total: number) => `${done} trên ${total} việc`,
    eventsTitle: "Sự kiện gần đây",
    noEvents: "Chưa có sự kiện",
    noEventsHint: "Sự kiện mới của harness sẽ hiện ở đây.",
} as const

/* ------------------------------------------------------------------ Workflow */

export const WORKFLOW = {
    breadcrumbs: "Vị trí",
    loadError: "Không tải được workflow",
    notFound: "Không tìm thấy workflow này",
    notFoundHint: (project: string, id: string) => `Dự án ${project} không có workflow ${id}.`,
    versions: (goal: number, graph: number, done: number, total: number) => `Goal v${goal} · graph v${graph} · ${done}/${total} Op hoàn tất`,
    reason: "Lý do",
    sent: "Đã gửi lệnh",
    refused: "Lệnh bị từ chối",
    changeGoal: "Đổi goal",
    changeGoalHint: (version: number) => `Goal hiện tại là v${version}. Goal mới tạo phiên bản kế tiếp và Kernel lập lại graph.`,
    goalField: "Goal",
    saveGoal: "Lưu goal mới",
    pause: "Tạm dừng",
    resume: "Tiếp tục",
    stop: "Dừng",
    stopTitle: "Dừng workflow?",
    stopBody: "Dừng không xoá công việc đã nộp; Op đang chạy được xử lý theo cách bạn chọn.",
    stopConfirm: "Dừng workflow",
    stopMode: "Cách dừng",
    stopGraceful: "Dừng êm",
    stopGracefulHint: "Không giao Op mới; chờ các Op đang chạy nộp xong.",
    stopHard: "Dừng ngay",
    stopHardHint: "Đóng các Op đang chạy; công việc chưa nộp phải chạy lại.",
    graphTitle: "Graph theo đợt",
    graphLabel: (id: string, waves: number) => `Graph của ${id}, ${waves} đợt, từ trên xuống`,
    graphEmpty: "Graph chưa có Op nào.",
    legend: "Chú giải trạng thái",
    legendSide: "BE / FE: phía của Op",
    statLive: "Op đang chạy",
    statQueued: "Hàng chờ",
    statWaves: "Số đợt",
    statDone: "Hoàn tất",
    wave: (n: number, count: number) => `Đợt ${n} · ${count} Op`,
    selectHint: "Op có task mở trang task khi bấm; chọn Op chưa có task để xem chi tiết.",
    nodeTitle: (label: string, title: string) => `${label} · ${title}`,
    member: "Member",
    side: "Phía",
    deps: "Phụ thuộc",
    record: "Record",
    why: "Lý do",
    noTask: "Op này chưa có task.",
    openTask: "Mở task",
    flowTitle: "Lane và kiểm tra flow",
    flowCode: "Flow của các lane",
    noLanes: "Chưa có lane nào.",
    flowClean: "Không có lỗi flow",
    flowCleanHint: "Không có TASK_NOT_SPLIT hay FLOW_INCOMPLETE.",
    flowProblems: (n: number) => `Lỗi flow (${n})`,
    seatsTitle: "Seat",
    noSeats: "Chưa có seat nào",
} as const

/* ------------------------------------------------------------------ Task */

export const TASK = {
    title: (label: string, title: string) => `${label} · ${title}`,
    fallbackTitle: (id: string) => `Task ${id}`,
    breadcrumbs: "Vị trí",
    loadError: "Không tải được task",
    notFound: "Không tìm thấy task này",
    notFoundHint: (project: string, id: string) => `Dự án ${project} không có task ${id}.`,
    contract: "Contract",
    summary: "Tóm tắt",
    allowPaths: "Đường dẫn được phép",
    anyPath: "Không giới hạn đường dẫn.",
    deps: "Phụ thuộc",
    record: "Record",
    step: "Bước",
    checks: "Check",
    checksTable: "Check của task",
    noChecks: "Chưa có check nào.",
    checkColumns: { name: "Check", tier: "Tier", state: "Trạng thái", detail: "Chi tiết" },
    terminal: "Terminal",
    noTerminal: "Terminal chưa có dòng nào.",
    route: "Vì sao chọn model này",
    routeFact: (tier: string) => `Route tier ${tier}`,
    routeSteps: "Các bước route",
    chosen: "Được chọn",
    model: "Model",
    effort: "Effort",
    by: "Theo",
    attempts: (n: number) => `Lịch sử attempt (${n})`,
    attemptsList: "Lịch sử attempt",
    noAttempts: "Chưa có attempt nào.",
} as const

/* ------------------------------------------------------------------ Cần quyết định */

export const INBOX = {
    title: "Cần quyết định",
    description: "Escalation cần chủ dự án quyết định, và yêu cầu chủ dự án gửi Supervisor. Việc Supervisor tự xử lý không xuất hiện ở đây.",
    list: "Quyết định đang chờ",
    listCard: "Danh sách quyết định",
    detail: "Chi tiết quyết định",
    loading: "Đang tải quyết định",
    loadError: "Không tải được danh sách quyết định",
    empty: "Không có quyết định nào đang chờ",
    emptyHint: "Escalation mới hiện ở đây khi Supervisor hay Kernel cần chủ dự án quyết định.",
    raised: (project: string, workflow: string, by: string) => `${project} · ${workflow} · do ${by} nêu`,
    body: "Nội dung",
    ruling: "Phương án",
    note: "Ghi chú thêm (tuỳ chọn)",
    send: "Gửi ruling",
    commandPrefix: "Quyết định sẽ chạy",
    commandSuffix: "với gate và role như khi gõ tay.",
    sent: "Đã gửi quyết định",
    refused: "Quyết định bị từ chối",
    ruledOption: "Phương án đã gửi",
    ruledNote: "Ghi chú đã gửi",
    noOption: "Không chọn phương án",
    noNote: "Không có ghi chú",
    ruledHint: "Quyết định đã gửi; mục này rời danh sách khi harness ghi nhận.",
} as const

/* ------------------------------------------------------------------ Yêu cầu cho Supervisor */

export const OWNER_REQUEST = {
    title: "Gửi yêu cầu cho Supervisor",
    card: "Gửi yêu cầu cho Supervisor",
    project: "Project",
    projectPlaceholder: "Chọn project",
    text: "Yêu cầu",
    textHint: "Nói bằng lời của thầy; Supervisor nhận ở lượt next kế tiếp.",
    send: "Gửi",
    commandPrefix: "Gửi chạy",
    commandSuffix: "với role owner.",
    sent: "Đã gửi yêu cầu cho Supervisor",
    refused: "Yêu cầu bị từ chối",
    noProjects: "Chưa có project nào đăng ký",
    list: "Yêu cầu đã gửi",
    listCard: "Yêu cầu đã gửi cho Supervisor",
    loadError: "Không tải được danh sách yêu cầu",
    empty: "Chưa có yêu cầu nào",
    emptyHint: "Yêu cầu thầy gửi Supervisor hiện ở đây cho tới khi một lệnh Supervisor đóng nó.",
    open: "chờ Supervisor",
    closed: "đã đóng",
    closedBy: (cmdId: string) => `đã đóng · ${cmdId}`,
} as const

/* ------------------------------------------------------------------ Cài đặt */

export const SETTINGS = {
    updateTitle: "Cập nhật app",
    updateVersion: (version: string) => `Phiên bản đang chạy ${version}`,
    updateLink: "Xem bản mới nhất trên GitHub",
    updateHref: "https://github.com/starci183/starci-harness/releases/latest",
    title: "Cài đặt",
    description: "Mỗi giá trị nằm trong file ops/*.yaml của nó. Lưu chạy starci config set, kiểm schema trước khi ghi.",
    groups: "Nhóm cấu hình",
    scrollPrevious: "Cuộn nhóm sang trái",
    scrollNext: "Cuộn nhóm sang phải",
    loading: "Đang tải cấu hình",
    loadError: "Không tải được cấu hình",
    empty: "Chưa có giá trị cấu hình nào",
    members: "Model",
    addModel: "Thêm model",
    addModelPlaceholder: "Chọn model",
    noMoreModels: "Đã có mọi model đã biết",
    noMoreSteps: "Đã có mọi bước đã biết",
    /** `{label}` is filled per tag. */
    removeTag: "Bỏ {label}",
    steps: "Các bước",
    tier: "Tier",
    tierEffort: (tier: string) => `Effort của tier ${tier}`,
    tierMembers: (tier: string) => `Model của tier ${tier}`,
    tierAdd: (tier: string) => `Thêm model vào tier ${tier}`,
    noTiers: "Chưa có tier nào trong routing.",
    reorderInstructions: "Kéo, hoặc Alt và phím mũi tên, để đổi thứ tự.",
    /** `{label}`, `{position}` and `{total}` are filled per tag. */
    reorderAnnouncement: "{label} ở vị trí {position} trên {total}",
    noMembers: "Chưa có model nào; tier này không nhận Op.",
    effort: "Effort",
    addStep: "Thêm bước",
    addStepPlaceholder: "Chọn bước",
    newItem: "Giá trị mới",
    add: "Thêm",
    noItems: "Danh sách trống.",
    jsonHint: (key: string) => `${key} · JSON`,
    jsonInvalid: "JSON không hợp lệ; giá trị này chưa vào danh sách lưu.",
    pending: (n: number) => `${n} thay đổi chưa lưu`,
    pendingFact: "Giá trị cũ → giá trị mới",
    pendingList: "Thay đổi chưa lưu",
    pendingActions: "Lưu hoặc bỏ thay đổi",
    refusedHint: "Lý do từ chối hiện dưới ô của từng giá trị.",
    refusedBadge: "Bị từ chối",
    discard: "Bỏ thay đổi",
    save: "Lưu thay đổi",
    saved: (n: number) => `Đã lưu ${n} thay đổi`,
    refusedSummary: (n: number) => `${n} thay đổi bị từ chối`,
    noneWritten: "Không giá trị nào được ghi.",
    othersSaved: (n: number) => `${n} thay đổi khác đã được lưu.`,
    emptyList: "(trống)",
    on: "Bật",
    off: "Tắt",
} as const

export const EFFORT_OPTIONS: readonly { readonly id: string; readonly label: string; readonly description: string }[] = [
    { id: "low", label: "Low", description: "Nhanh và rẻ, cho việc cơ học." },
    { id: "medium", label: "Medium", description: "Cân bằng cho việc thường ngày." },
    { id: "high", label: "High", description: "Suy luận kỹ cho việc nhiều bước." },
    { id: "max", label: "Max", description: "Suy luận tối đa cho việc khó nhất." },
]

export interface ConfigGroupLabel {
    readonly id: string
    readonly label: string
    readonly description: string
}

export const CONFIG_GROUPS: readonly ConfigGroupLabel[] = [
    { id: "models", label: "Model và effort", description: "Model nào nhận Op ở mỗi tier, và mức effort của tier đó." },
    { id: "parallel", label: "Song song", description: "Số Op được chạy cùng lúc, theo workflow và theo nhà cung cấp." },
    { id: "lanes", label: "Lane", description: "Các bước mỗi lane đi qua, theo thứ tự." },
    { id: "stall", label: "Đứng và hết giờ", description: "Khi nào một Op bị coi là đứng hoặc khởi chạy hỏng." },
    { id: "host", label: "Host", description: "Vòng lặp của harness trên máy này." },
]

export const TIER: Readonly<Record<string, { readonly label: string; readonly description: string }>> = {
    frontier: { label: "Frontier", description: "Kiến trúc, gỡ lỗi khó và việc của Kernel; dùng model mạnh nhất." },
    high: { label: "Cao", description: "Code nhiều bước và review, cần suy luận chắc." },
    medium: { label: "Trung bình", description: "Code thường ngày, test và tài liệu." },
    low: { label: "Thấp", description: "Việc cơ học: định dạng, đổi tên, sửa nhỏ." },
}

/** Human label and one-line description of a config key; a key not listed falls back to its own words. */
export const CONFIG_FIELD: Readonly<Record<string, { readonly label: string; readonly description?: string }>> = {
    "routing.workflowParallel": { label: "Op tối đa mỗi workflow", description: "Số Op một workflow chạy cùng lúc." },
    "routing.pools.claude.maxParallel": { label: "Claude · Op cùng lúc" },
    "routing.pools.codex.maxParallel": { label: "Codex · Op cùng lúc" },
    "routing.pools.devin.maxParallel": { label: "Devin · Op cùng lúc" },
    "routing.pools.cursor.maxParallel": { label: "Cursor · Op cùng lúc" },
    "stall.silentMinutes": { label: "Im lặng tối đa (phút)", description: "Op không có output lâu hơn thì bị coi là đứng." },
    "stall.launchTimeoutSeconds": { label: "Hạn khởi chạy (giây)", description: "Op chưa báo khởi chạy sau chừng này thì bị coi là hỏng." },
    "host.watch": { label: "Tự động theo dõi (watch)", description: "Harness tự chạy tick theo chu kỳ." },
    "host.tickSeconds": { label: "Chu kỳ tick (giây)", description: "Khoảng cách giữa hai lần tick." },
}

const words = (segment: string) => segment.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").toLowerCase()

/** `routing.pools.claude.maxParallel` -> the listed label, else `Claude · max parallel` from its last two segments. */
export const configFieldLabel = (key: string): { readonly label: string; readonly description?: string } => {
    const known = CONFIG_FIELD[key]
    if (known !== undefined) return known
    const lane = /^lanes\.([^.]+)\.steps$/.exec(key)
    if (lane?.[1] !== undefined) return { label: `Lane ${lane[1]}`, description: "Các bước theo thứ tự." }
    const pool = /^routing\.pools\.([^.]+)\.maxParallel$/.exec(key)
    if (pool?.[1] !== undefined) return { label: `${PROVIDER_NAME[pool[1] as ProviderId] ?? pool[1]} · Op cùng lúc` }
    const parts = key.split(".")
    const last = words(parts.at(-1) ?? key)
    const owner = parts.length > 2 ? parts.at(-2) : undefined
    const label = owner === undefined ? last : `${owner} · ${last}`
    return { label: label.charAt(0).toUpperCase() + label.slice(1) }
}

/* ------------------------------------------------------------------ connect screen */

export const CONNECT = {
    resolving: "Đang tìm starci ui",
    subtitle: "Kết nối tới harness",
    card: "Kết nối",
    title: "Kết nối tới starci ui",
    intro: "Chạy starci ui trong terminal của harness. Lệnh in ra một URL có token; dán URL đó vào đây. App chỉ kết nối tới 127.0.0.1.",
    refused: "Server từ chối kết nối",
    form: "Kết nối",
    url: "URL starci ui",
    urlPlaceholder: "http://127.0.0.1:4317/?token=…",
    urlInvalid: "Dán nguyên URL starci ui in ra, dạng http://127.0.0.1:4317/?token=…",
    connect: "Kết nối",
    fixtures: "Xem bằng dữ liệu mẫu",
} as const
