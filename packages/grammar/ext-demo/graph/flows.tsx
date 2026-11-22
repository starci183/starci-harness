import type { ReactElement } from "react"
import { BellIcon, BoltIcon, BoxIcon, BranchIcon, CalendarIcon, CardIcon, ChatIcon, ClockIcon, DocIcon, FlagIcon, MailIcon, PhoneIcon, SearchIcon, TruckIcon, UserIcon } from "./icons.tsx"
import { FlowGraph, type FlowNode, type FlowStatus, type FlowStatusLabels, type GraphEdge } from "../../src/core/ext/graph/index.ts"
import { WORDS } from "./stories.tsx"

const bigIcons = (): Record<string, ReactElement> => {
    const out: Record<string, ReactElement> = { s0: <BoltIcon />, end: <FlagIcon /> }
    for (let i = 1; i <= 6; i += 1) {
        const k = String(i)
        out["c" + k] = <SearchIcon />
        out["y" + k] = <BoltIcon />
        out["x" + k] = <UserIcon />
        out["m" + k] = <DocIcon />
    }
    return out
}

/** The subject icon of each node of each flow (a phone for a call, a clock for a wait, a calendar for an appointment, a bolt for a trigger ...). */
const ICONS: Readonly<Record<string, Readonly<Record<string, ReactElement>>>> = {
    linear: { a: <BoltIcon />, b: <BoxIcon />, c: <CardIcon />, d: <TruckIcon />, e: <FlagIcon /> },
    "branch-merge": { start: <BoltIcon />, mail: <MailIcon />, call: <PhoneIcon />, log: <DocIcon />, end: <FlagIcon /> },
    "nested-branch": { start: <BoltIcon />, ship: <TruckIcon />, back: <BoxIcon />, remind: <BellIcon />, log: <DocIcon />, end: <FlagIcon /> },
    loop: { start: <BoltIcon />, dial: <PhoneIcon />, pause: <ClockIcon />, won: <CalendarIcon /> },
    "loop-two-exits": { start: <BoltIcon />, dial: <PhoneIcon />, pause: <ClockIcon />, won: <CalendarIcon />, lost: <FlagIcon /> },
    parallel: { start: <BoltIcon />, a: <MailIcon />, b: <ChatIcon />, c: <BellIcon />, join: <BranchIcon />, end: <FlagIcon /> },
    "long-labels": { start: <ChatIcon />, mail: <MailIcon />, call: <PhoneIcon />, log: <DocIcon />, end: <FlagIcon /> },
    "wait-person": { a: <BoltIcon />, b: <UserIcon />, c: <BellIcon /> },
    "wait-time": { a: <BoltIcon />, b: <ClockIcon />, c: <BellIcon /> },
    "wait-external": { a: <BoltIcon />, b: <ChatIcon />, c: <BellIcon /> },
    "error-reason": { a: <BoltIcon />, b: <ChatIcon />, c: <BellIcon /> },
    big: bigIcons(),
    "wait-loops": { start: <BoltIcon />, note: <DocIcon />, wait: <ClockIcon />, br1: <BranchIcon />, br2: <BranchIcon />, order: <CardIcon />, ask: <ChatIcon />, remind: <BellIcon />, again: <MailIcon />, close: <FlagIcon /> },
    "order-approval": { placed: <BoltIcon />, approve: <UserIcon />, auto: <CardIcon />, ship: <TruckIcon />, done: <FlagIcon /> },
}

/** The state mixes every flow is drawn in. */
export const MIXES = ["todo", "running", "waiting", "error", "done"] as const
export type Mix = (typeof MIXES)[number]

export interface Decision {
    readonly id: string
    /** The branch that stands on its left (Có) and the one on its right (Không). */
    readonly left: string
    readonly right: string
}

export interface Flow {
    readonly id: string
    readonly title: string
    readonly note: string
    readonly nodes: readonly FlowNode[]
    readonly edges: readonly GraphEdge[]
    /** The order the run reaches the nodes in, for the mixes. */
    readonly order: readonly string[]
    /** Nodes a finished run skipped (an untaken branch). */
    readonly skip: readonly string[]
    /** The happy path: its centres share one x. */
    readonly spine: readonly string[]
    readonly decisions: readonly Decision[]
    /** The status words and the skipped words of this flow, when it is not in the demo's own language. */
    readonly words?: { readonly status: FlowStatusLabels; readonly skipped: string }
    /** The mix this flow is always drawn in (the wait and error stories). */
    readonly fixed?: Mix
    /** The most edge crossings the flow may have (default 0). */
    readonly crossings?: number
}

const n = (id: string, label: string, extra: Partial<FlowNode> = {}): FlowNode => ({ id, label, kind: "action", ...extra })
const e = (source: string, target: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({ source, target, ...extra })
const yes = { id: "yes", label: "Có" }
const no = { id: "no", label: "Không" }
const decide = (id: string, label: string, outputs: FlowNode["outputs"] = [yes, no]): FlowNode => ({ id, label, shape: "diamond", kind: "condition", outputs })

const big = (): Flow => {
    const nodes: FlowNode[] = [n("s0", "Nhận đơn", { kind: "event" })]
    const edges: GraphEdge[] = []
    const order: string[] = ["s0"]
    const skip: string[] = []
    const spine: string[] = ["s0"]
    const decisions: Decision[] = []
    let previous = "s0"
    for (let i = 1; i <= 6; i += 1) {
        const k = String(i)
        nodes.push(n(`c${k}`, `Kiểm tra bước ${k}`, { kind: "action" }), decide(`d${k}`, `Đạt yêu cầu ${k}?`), n(`y${k}`, `Xử lý nhanh ${k}`), n(`x${k}`, `Xử lý kỹ ${k}`), n(`m${k}`, `Ghi nhận ${k}`))
        edges.push(e(previous, `c${k}`), e(`c${k}`, `d${k}`), e(`d${k}`, `y${k}`, { sourcePort: "yes" }), e(`d${k}`, `x${k}`, { sourcePort: "no" }), e(`y${k}`, `m${k}`), e(`x${k}`, `m${k}`))
        order.push(`c${k}`, `d${k}`, `y${k}`, `m${k}`)
        skip.push(`x${k}`)
        spine.push(`c${k}`, `d${k}`, `m${k}`)
        decisions.push({ id: `d${k}`, left: `y${k}`, right: `x${k}` })
        previous = `m${k}`
    }
    nodes.push(n("end", "Hoàn tất", { kind: "end" }))
    edges.push(e(previous, "end"))
    order.push("end")
    spine.push("end")
    return { id: "big", title: "Luồng 30 nút", note: "Sáu khối kiểm tra, rẽ nhánh và gộp lại trên một trục.", nodes, edges, order, skip, spine, decisions }
}

const waitFlow = (id: string, title: string, node: Partial<FlowNode>): Flow => ({
    id,
    title,
    note: "Chờ thì viền hổ phách, chip trên cạnh trên, cạnh ra đứng yên.",
    nodes: [n("a", "Đăng bài", { kind: "event" }), n("b", "Chờ bước tiếp", node), n("c", "Gửi thông báo")],
    edges: [e("a", "b"), e("b", "c")],
    order: ["a", "b", "c"],
    skip: [],
    spine: ["a", "b", "c"],
    decisions: [],
    fixed: "waiting",
})

const ENGLISH: FlowStatusLabels = { done: "Done", running: "Running", wait: "Waiting", error: "Failed", skipped: "Skipped", todo: "Not run" }

export const FLOWS: readonly Flow[] = [
    {
        id: "order-approval",
        title: "Order approval (neutral example)",
        note: "A generic app: an order is checked, approved by a manager above a limit, then shipped. Every word is the app's.",
        nodes: [
            n("placed", "Order placed", { kind: "event" }),
            decide("limit", "Over the limit?", [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }]),
            n("approve", "Manager approval", { wait: { kind: "person", label: "Needs approval", detail: "waiting for the sales manager" } }),
            n("auto", "Approve automatically"),
            n("ship", "Ship the order"),
            n("done", "Order complete", { kind: "end" }),
        ],
        edges: [e("placed", "limit"), e("limit", "approve", { sourcePort: "yes" }), e("limit", "auto", { sourcePort: "no" }), e("approve", "ship"), e("auto", "ship"), e("ship", "done")],
        order: ["placed", "limit", "approve", "ship", "done"],
        skip: ["auto"],
        spine: ["placed", "limit", "ship", "done"],
        decisions: [{ id: "limit", left: "approve", right: "auto" }],
        words: { status: ENGLISH, skipped: "Skipped" },
    },
    waitFlow("wait-person", "Chờ người", { wait: { kind: "person", label: "Chờ duyệt", detail: "chờ chị Lan · từ 14:05" } }),
    waitFlow("wait-time", "Chờ giờ", { wait: { kind: "time", label: "Chờ giờ", detail: "còn 12 phút · tới 15:30" } }),
    waitFlow("wait-external", "Chờ bên ngoài", { wait: { kind: "external", label: "Chờ TikTok", detail: "TikTok đang xử lý · thử lại 15:45" } }),
    {
        ...waitFlow("error-reason", "Lỗi có lý do", { errorReason: "Tài khoản TikTok chưa cấp quyền đăng bài" }),
        note: "Lỗi nói lý do nghiệp vụ, không nói mã.",
        fixed: "error",
    },
    {
        id: "linear",
        title: "Tuyến tính",
        note: "Một trục thẳng, các tâm cùng x.",
        nodes: [n("a", "Nhận đơn", { kind: "event" }), n("b", "Kiểm tra kho"), n("c", "Thu tiền"), n("d", "Giao hàng"), n("e", "Hoàn tất", { kind: "end" })],
        edges: [e("a", "b"), e("b", "c"), e("c", "d"), e("d", "e")],
        order: ["a", "b", "c", "d", "e"],
        skip: [],
        spine: ["a", "b", "c", "d", "e"],
        decisions: [],
    },
    {
        id: "branch-merge",
        title: "Rẽ nhánh và gộp lại",
        note: "Có bên trái, Không bên phải, gộp lại trên trục.",
        nodes: [n("start", "Đơn mới", { kind: "event" }), decide("check", "Đã thanh toán?"), n("mail", "Gửi email xác nhận"), n("call", "Gọi điện nhắc"), n("log", "Ghi nhận"), n("end", "Hoàn tất", { kind: "end" })],
        edges: [e("start", "check"), e("check", "mail", { sourcePort: "yes" }), e("check", "call", { sourcePort: "no" }), e("mail", "log"), e("call", "log"), e("log", "end")],
        order: ["start", "check", "mail", "log", "end"],
        skip: ["call"],
        spine: ["start", "check", "log", "end"],
        decisions: [{ id: "check", left: "mail", right: "call" }],
    },
    {
        id: "nested-branch",
        title: "Rẽ nhánh lồng nhau",
        note: "Một nhánh lại rẽ tiếp; tất cả gộp lại ở cuối.",
        nodes: [
            n("start", "Đơn mới", { kind: "event" }),
            decide("paid", "Đã thanh toán?"),
            decide("stock", "Còn hàng?"),
            n("ship", "Giao hàng"),
            n("back", "Đặt thêm"),
            n("remind", "Nhắc thanh toán"),
            n("log", "Ghi nhận"),
            n("end", "Hoàn tất", { kind: "end" }),
        ],
        edges: [e("start", "paid"), e("paid", "stock", { sourcePort: "yes" }), e("paid", "remind", { sourcePort: "no" }), e("stock", "ship", { sourcePort: "yes" }), e("stock", "back", { sourcePort: "no" }), e("ship", "log"), e("back", "log"), e("remind", "log"), e("log", "end")],
        order: ["start", "paid", "stock", "ship", "log", "end"],
        skip: ["back", "remind"],
        spine: ["start", "paid", "log", "end"],
        decisions: [{ id: "paid", left: "stock", right: "remind" }, { id: "stock", left: "ship", right: "back" }],
        crossings: 1,
    },
    {
        id: "loop",
        title: "Vòng lặp",
        note: "Cạnh quay lại chạy trong khung, ở lề bên của nhánh nó; một lối ra.",
        nodes: [
            n("start", "Có lead mới", { kind: "event" }),
            { id: "retry", label: "Thử gọi lại", container: { kind: "loop", childIds: ["dial", "pause"], description: "tối đa 5 lần", attempt: "lần 2/5", exits: [{ id: "done", label: "Đã liên lạc" }] } },
            n("dial", "Gọi điện"),
            n("pause", "Chờ 1 giờ", { kind: "wait", wait: { kind: "time", label: "Chờ giờ", detail: "còn 42 phút · tới 15:30" } }),
            n("won", "Hẹn lịch"),
        ],
        edges: [e("start", "retry"), e("dial", "pause"), e("pause", "dial", { variant: "back", label: "lặp" }), e("retry", "won", { sourcePort: "done" })],
        order: ["start", "dial", "pause", "won"],
        skip: [],
        spine: ["start", "retry", "won"],
        decisions: [],
    },
    {
        id: "loop-two-exits",
        title: "Vòng lặp, hai lối ra",
        note: "Mỗi lối ra rời khung ở cạnh dưới; chữ nằm ngoài khung.",
        nodes: [
            n("start", "Có lead mới", { kind: "event" }),
            { id: "retry", label: "Thử gọi lại", container: { kind: "loop", childIds: ["dial", "check", "pause"], description: "tối đa 5 lần", attempt: "lần 2/5", exits: [{ id: "reached", label: "Đã liên lạc" }, { id: "gave", label: "Bỏ cuộc", tone: "danger" }] } },
            n("dial", "Gọi điện"),
            decide("check", "Bắt máy?"),
            n("pause", "Chờ 1 giờ", { kind: "wait", wait: { kind: "time", label: "Chờ giờ", detail: "còn 42 phút · tới 15:30" } }),
            n("won", "Hẹn lịch"),
            n("lost", "Đóng lead", { kind: "end" }),
        ],
        edges: [e("start", "retry"), e("dial", "check"), e("check", "pause", { sourcePort: "no" }), e("pause", "dial", { variant: "back", label: "lặp" }), e("retry", "won", { sourcePort: "reached" }), e("retry", "lost", { sourcePort: "gave" })],
        order: ["start", "dial", "check", "pause", "won"],
        skip: ["lost"],
        spine: ["start", "retry"],
        decisions: [],
    },
    {
        id: "parallel",
        title: "Song song",
        note: "Ba nhánh chạy cùng lúc rồi gộp lại.",
        nodes: [n("start", "Đơn mới", { kind: "event" }), n("a", "Gửi email"), n("b", "Gửi tin nhắn"), n("c", "Báo kênh chung"), n("join", "Gộp kết quả"), n("end", "Hoàn tất", { kind: "end" })],
        edges: [e("start", "a"), e("start", "b"), e("start", "c"), e("a", "join"), e("b", "join"), e("c", "join"), e("join", "end")],
        order: ["start", "a", "b", "c", "join", "end"],
        skip: [],
        spine: ["start", "b", "join", "end"],
        decisions: [{ id: "start", left: "a", right: "c" }],
    },
    {
        id: "long-labels",
        title: "Nhãn tiếng Việt dài",
        note: "Tên bước và tên nhánh dài vẫn không đè nhau.",
        nodes: [
            n("start", "Khách hàng gửi yêu cầu hỗ trợ qua nhiều kênh khác nhau", { kind: "event", description: "tiếp nhận từ Zalo, Messenger và email" }),
            { ...decide("check", "Khách hàng đã thanh toán đầy đủ chưa?"), outputs: [{ id: "yes", label: "Đã thanh toán đầy đủ" }, { id: "no", label: "Chưa thanh toán hoặc còn thiếu" }] },
            n("mail", "Gửi email xác nhận đơn hàng kèm hoá đơn điện tử", { description: "mẫu thư cảm ơn khách hàng thân thiết" }),
            n("call", "Gọi điện nhắc khách hàng hoàn tất thanh toán", { description: "tối đa ba lần trong bảy ngày" }),
            n("log", "Ghi nhận kết quả xử lý vào hồ sơ khách hàng"),
            n("end", "Hoàn tất toàn bộ quy trình chăm sóc", { kind: "end" }),
        ],
        edges: [e("start", "check"), e("check", "mail", { sourcePort: "yes" }), e("check", "call", { sourcePort: "no" }), e("mail", "log"), e("call", "log"), e("log", "end")],
        order: ["start", "check", "mail", "log", "end"],
        skip: ["call"],
        spine: ["start", "check", "log", "end"],
        decisions: [{ id: "check", left: "mail", right: "call" }],
    },
    {
        id: "wait-loops",
        title: "Chờ sự kiện, hai vòng quay lại",
        note: "Dáng luồng của NIVO: bước chờ rẽ hai ngả, mỗi ngả rẽ tiếp; một bước ở nhánh trái và một bước sâu hơn ở nhánh phải quay lại chờ tiếp.",
        nodes: [
            n("start", "Khách hỏi báo giá", { kind: "event" }),
            n("note", "Gửi một ghi chú"),
            n("wait", "Chờ sự kiện", { kind: "wait", wait: { kind: "external", label: "Đang chờ bạn", detail: "01:38 18-11" } }),
            { ...n("br1", "Rẽ nhánh", { kind: "condition" }), outputs: [{ id: "yes", label: "có" }, { id: "no", label: "không" }] },
            { ...n("br2", "Rẽ nhánh", { kind: "condition" }), outputs: [{ id: "yes", label: "có" }, { id: "no", label: "không" }] },
            n("order", "Tạo đơn hàng"),
            n("ask", "Hỏi lại khách"),
            n("remind", "Nhắc khách"),
            n("again", "Gửi nhắc lần hai"),
            n("close", "Đóng việc", { kind: "end" }),
        ],
        edges: [
            e("start", "note", { label: "có sự kiện" }),
            e("note", "wait", { label: "xong" }),
            e("wait", "br1", { label: "có sự kiện" }),
            e("wait", "br2", { label: "quá hạn", variant: "fallback" }),
            e("br1", "order", { sourcePort: "yes" }),
            e("br1", "ask", { sourcePort: "no" }),
            e("br2", "remind", { sourcePort: "yes" }),
            e("br2", "close", { sourcePort: "no" }),
            e("remind", "again"),
            e("ask", "wait", { variant: "back", label: "chờ tiếp" }),
            e("again", "wait", { variant: "back", label: "chờ tiếp" }),
        ],
        order: ["start", "note", "wait", "br1", "order"],
        skip: ["br2", "ask", "remind", "again", "close"],
        spine: ["start", "note", "wait"],
        decisions: [],
        // Each loop-back crosses the line from its branch to the step beside it: the lane between two columns is the nearest free one.
        crossings: 2,
    },
    big(),
]

/** The statuses of a flow in a mix: the nodes before the middle one done, the middle one in the mix's state, the rest not run; `done` finishes the run (an untaken branch skipped). */
export const statusesFor = (flow: Flow, mix: Mix): Readonly<Record<string, FlowStatus>> => {
    const out: Record<string, FlowStatus> = {}
    for (const node of flow.nodes) out[node.id] = "todo"
    if (mix === "todo") return out
    if (mix === "done") {
        for (const id of flow.order) out[id] = "done"
        for (const id of flow.skip) out[id] = "skipped"
        return out
    }
    const at = Math.max(1, Math.floor(flow.order.length / 2))
    flow.order.forEach((id, index) => {
        out[id] = index < at ? "done" : index === at ? (mix === "running" ? "running" : mix === "waiting" ? "wait" : "error") : "todo"
    })
    return out
}

export const FlowStory = ({ flow, mix: asked }: { readonly flow: Flow; readonly mix: Mix }): ReactElement => {
    const mix = flow.fixed ?? asked
    const statuses = statusesFor(flow, mix)
    const nodes = flow.nodes.map((node) => ({ ...node, status: statuses[node.id] ?? "todo", ...(ICONS[flow.id]?.[node.id] === undefined ? {} : { icon: ICONS[flow.id]?.[node.id] }) }))
    return (
        <FlowGraph
            label={flow.title}
            nodes={nodes}
            edges={flow.edges}
            direction="TB"
            statusLabels={flow.words?.status ?? WORDS}
            skippedLabel={flow.words?.skipped ?? "Bỏ qua"}
            ariaLabelConfig={{ "controls.zoomIn.ariaLabel": "Phóng to", "controls.zoomOut.ariaLabel": "Thu nhỏ", "controls.fitView.ariaLabel": "Vừa khung" }}
        />
    )
}
