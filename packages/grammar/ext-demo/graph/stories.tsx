import { useState, type ReactElement, type ReactNode } from "react"
import { FlowGraph, SchemaMap, type FlowLegendItem, type FlowNode, type FlowStatusLabels, type GraphEdge, type GraphPositions, type SchemaEntity } from "../../src/core/ext/graph/index.ts"

/** The words of the demo, as an app would pass them in its own language. */
export const WORDS: FlowStatusLabels = { done: "Xong", running: "Đang chạy", wait: "Chờ", error: "Lỗi", skipped: "Bỏ qua", todo: "Chưa chạy" }
const SKIPPED = "Bỏ qua"

const Glyph = ({ d }: { readonly d: string }): ReactElement => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
    </svg>
)
const bolt = <Glyph d="M13 2 4 14h7l-1 8 9-12h-7z" />
const mail = <Glyph d="M4 6h16v12H4zM4 7l8 6 8-6" />
const user = <Glyph d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />
const flag = <Glyph d="M5 21V4h11l-2 4 2 4H5" />
const avatar = <span style={{ display: "block", inlineSize: "100%", blockSize: "100%", background: "var(--accent)" }} />

const common = {
    direction: "TB" as const,
    statusLabels: WORDS,
    skippedLabel: SKIPPED,
    ariaLabelConfig: { "controls.zoomIn.ariaLabel": "Phóng to", "controls.zoomOut.ariaLabel": "Thu nhỏ", "controls.fitView.ariaLabel": "Vừa khung" },
} as const

const STATUS_LEGEND: FlowLegendItem[] = [
    { label: WORDS.done, status: "done" },
    { label: WORDS.running, status: "running" },
    { label: WORDS.wait, status: "wait" },
    { label: WORDS.error, status: "error" },
    { label: WORDS.skipped, status: "skipped" },
    { label: WORDS.todo, status: "todo" },
]

const statesNodes: FlowNode[] = [
    { id: "start", label: "Nhận đơn", description: "webhook", icon: bolt, status: "done", kind: "event" },
    { id: "run", label: "Gửi email", description: "smtp", icon: mail, status: "running", kind: "action" },
    { id: "run2", label: "Ghi nhận", status: "todo", kind: "action" },
    { id: "wait", label: "Chờ duyệt", description: "quản lý", icon: user, status: "wait", kind: "ask" },
    { id: "wait2", label: "Gửi hợp đồng", status: "todo", kind: "action" },
    { id: "err", label: "Gọi thanh toán", description: "HTTP 502", status: "error", kind: "action" },
    { id: "skip", label: "Nhắc lại", status: "skipped", kind: "action" },
]
const statesEdges: GraphEdge[] = [
    { source: "start", target: "run" },
    { source: "run", target: "run2" },
    { source: "start", target: "wait" },
    { source: "wait", target: "wait2" },
    { source: "start", target: "err" },
    { source: "start", target: "skip" },
]

const decisionNodes: FlowNode[] = [
    { id: "start", label: "Đơn mới", icon: bolt, status: "done", kind: "event" },
    { id: "paid", label: "Đã thanh toán?", shape: "diamond", kind: "condition", status: "done", outputs: [{ id: "yes", label: "Có" }, { id: "no", label: "Chưa" }, { id: "late", label: "Quá hạn" }] },
    { id: "ship", label: "Giao hàng", description: "kho HCM", icon: flag, status: "running", kind: "action" },
    { id: "remind", label: "Nhắc thanh toán", icon: mail, status: "skipped", kind: "action" },
    { id: "cancel", label: "Huỷ đơn", status: "skipped", kind: "action" },
    { id: "ok", label: "Kiểm tra kho", kind: "condition", status: "done", outputs: [{ id: "in", label: "Còn hàng" }, { id: "out", label: "Hết", tone: "danger" }] },
    { id: "pack", label: "Đóng gói", status: "todo", kind: "action" },
    { id: "backorder", label: "Đặt thêm", status: "skipped", kind: "action" },
]
const decisionEdges: GraphEdge[] = [
    { source: "start", target: "paid" },
    { source: "paid", target: "ok", sourcePort: "yes", variant: "taken" },
    { source: "paid", target: "remind", sourcePort: "no" },
    { source: "paid", target: "cancel", sourcePort: "late" },
    { source: "ok", target: "ship", sourcePort: "in", variant: "taken" },
    { source: "ok", target: "backorder", sourcePort: "out" },
    { source: "ship", target: "pack" },
]

const containerNodes: FlowNode[] = [
    { id: "in", label: "Đơn hàng", status: "done", kind: "event", icon: bolt },
    { id: "billing", label: "Thanh toán", container: { childIds: ["card", "invoice"], chips: [{ label: "2 bước", tone: "accent" }] }, status: "done" },
    { id: "card", label: "Thu tiền thẻ", status: "done", kind: "action" },
    { id: "invoice", label: "Xuất hoá đơn", status: "done", kind: "action", icon: mail },
    { id: "fulfil", label: "Giao hàng", container: { childIds: ["pick", "ship"] }, status: "running" },
    { id: "pick", label: "Lấy hàng", status: "done", kind: "action" },
    { id: "ship", label: "Vận chuyển", status: "running", kind: "action", icon: flag },
    { id: "done", label: "Hoàn tất", status: "todo", kind: "end" },
]
const containerEdges: GraphEdge[] = [
    { source: "in", target: "billing" },
    { source: "card", target: "invoice" },
    { source: "billing", target: "fulfil" },
    { source: "pick", target: "ship" },
    { source: "fulfil", target: "done" },
]

const islandNodes: FlowNode[] = [
    { id: "a1", label: "Đăng ký", status: "done", kind: "event", icon: user },
    { id: "a2", label: "Gửi chào mừng", status: "done", kind: "action", icon: mail },
    { id: "b1", label: "Mỗi sáng 8h", status: "done", kind: "event" },
    { id: "b2", label: "Tổng hợp báo cáo", status: "running", kind: "action" },
    { id: "b3", label: "Gửi báo cáo", status: "todo", kind: "action", icon: mail },
    { id: "c1", label: "Khi có lỗi", status: "todo", kind: "event", icon: bolt },
    { id: "c2", label: "Báo kênh chung", status: "todo", kind: "action" },
    { id: "d1", label: "Ghi chú rời", status: "todo", kind: "wait" },
]
const islandEdges: GraphEdge[] = [
    { source: "a1", target: "a2" },
    { source: "b1", target: "b2" },
    { source: "b2", target: "b3" },
    { source: "c1", target: "c2" },
]

const legendNodes: FlowNode[] = [
    { id: "t", label: "Khách nhắn tin", tag: "Khởi động", icon: bolt, status: "done", kind: "event", count: 128, href: "#t" },
    { id: "ask", label: "Hỏi quản lý", icon: user, status: "wait", kind: "ask", chips: [{ label: "= order.id", tone: "accent" }, { label: "cố định" }], agent: avatar, agentName: "Trợ lý bán hàng" },
    { id: "d", label: "Duyệt?", shape: "diamond", kind: "condition", status: "done", outputs: [{ id: "y", label: "Duyệt" }, { id: "n", label: "Từ chối" }] },
    { id: "go", label: "Gửi hợp đồng", icon: mail, status: "running", kind: "action", outputs: [{ id: "ok", label: "Xong" }, { id: "err", label: "Lỗi", tone: "danger" }] },
    { id: "no", label: "Báo từ chối", status: "skipped", kind: "action" },
    { id: "end", label: "Kết thúc", status: "todo", kind: "end", icon: flag },
    { id: "alert", label: "Báo kênh chung", status: "todo", kind: "action" },
]
const legendEdges: GraphEdge[] = [
    { source: "t", target: "ask" },
    { source: "ask", target: "d" },
    { source: "d", target: "go", sourcePort: "y", variant: "taken" },
    { source: "d", target: "no", sourcePort: "n" },
    { source: "go", target: "end", sourcePort: "ok" },
    { source: "go", target: "alert", sourcePort: "err", variant: "fallback", label: "quá hạn" },
]
const FULL_LEGEND: FlowLegendItem[] = [
    { label: "Sự kiện", kind: "event" },
    { label: "Hành động", kind: "action" },
    { label: "Điều kiện", kind: "condition", shape: "diamond" },
    { label: "Cần người", kind: "ask" },
    { label: "Vòng lặp", kind: "loop" },
    ...STATUS_LEGEND,
    { label: "Đã đi", edge: "taken" },
    { label: "Dự phòng", edge: "fallback" },
    { label: "Không đi", edge: "skipped" },
    { label: "Đang chạy", edge: "running" },
    { label: "Đang chờ", edge: "wait" },
]

const edgeNodes: FlowNode[] = [
    { id: "a", label: "Bước đầu", status: "done", kind: "action" },
    { id: "b", label: "Đã đi", status: "done", kind: "action" },
    { id: "c", label: "Dự phòng", status: "todo", kind: "wait" },
    { id: "d", label: "Không đi", status: "skipped", kind: "action" },
    { id: "e", label: "Chỗ trống", placeholder: true },
]
const edgeEdges: GraphEdge[] = [
    { source: "a", target: "b", variant: "taken" },
    { source: "a", target: "c", variant: "fallback", label: "hết hạn" },
    { source: "a", target: "d", variant: "skipped", label: "không đi" },
    { source: "a", target: "e", placeholder: true },
    { source: "b", target: "a", variant: "back" },
]

const entities: SchemaEntity[] = [
    { id: "contact", label: "Liên hệ", description: "người mua", count: 1280, icon: user, fields: [{ id: "n", label: "Tên", type: "văn bản" }, { id: "p", label: "Số điện thoại", type: "văn bản" }, { id: "t", label: "Thẻ", type: "danh sách" }] },
    { id: "order", label: "Đơn hàng", description: "đơn đã chốt", count: 342, icon: flag, fields: Array.from({ length: 9 }, (_, index) => ({ id: `f${String(index)}`, label: `Trường ${String(index + 1)}`, type: index === 0 ? "liên kết" : "số" })) },
    { id: "product", label: "Sản phẩm", count: 56, icon: bolt, fields: [{ id: "s", label: "SKU", type: "văn bản" }, { id: "pr", label: "Giá", type: "số" }] },
    { id: "lead", label: "Lead", count: 94, icon: mail },
]

interface Story {
    readonly id: string
    readonly title: string
    readonly note: string
    readonly render: () => ReactElement
}

const Frame = ({ children, label }: { readonly children: ReactNode; readonly label: string }): ReactElement => (
    <div className="demo-frame" aria-label={label}>
        {children}
    </div>
)

const Editable = (): ReactElement => {
    const [saved, setSaved] = useState<GraphPositions>({})
    return (
        <>
            <Frame label="editable">
                <FlowGraph label="Đồ thị có thể sắp xếp" nodes={statesNodes} edges={statesEdges} editable positions={saved} onPositionsChange={setSaved} resetLabel="Đặt lại bố cục" {...common} />
            </Frame>
            <pre className="demo-readout" data-testid="positions">
                {JSON.stringify(saved)}
            </pre>
        </>
    )
}

export const STORIES: readonly Story[] = [
    {
        id: "states",
        title: "Sáu trạng thái",
        note: "Xong, Đang chạy (xanh lá, vòng quay, cạnh ra chạy), Chờ (hổ phách, dừng, cạnh tĩnh), Lỗi, Bỏ qua, Chưa chạy.",
        render: () => <FlowGraph label="Sáu trạng thái" nodes={statesNodes} edges={statesEdges} legend={STATUS_LEGEND} {...common} />,
    },
    {
        id: "decision",
        title: "Rẽ nhánh: nhánh đã đi và nhánh bỏ qua",
        note: "Nhánh đã đi nét liền; nhánh còn lại mờ, nét chấm, mang chữ Bỏ qua.",
        render: () => <FlowGraph label="Rẽ nhánh" nodes={decisionNodes} edges={decisionEdges} {...common} />,
    },
    {
        id: "containers",
        title: "Vùng chứa",
        note: "Hai nhóm, mỗi nhóm bày đồ thị con bên trong.",
        render: () => <FlowGraph label="Vùng chứa" nodes={containerNodes} edges={containerEdges} {...common} />,
    },
    {
        id: "islands",
        title: "Các mảng rời",
        note: "Các đồ thị con không nối với nhau nằm cạnh nhau, xuống hàng khi hết chiều rộng.",
        render: () => <FlowGraph label="Các mảng rời" nodes={islandNodes} edges={islandEdges} islandsWidth={900} {...common} />,
    },
    {
        id: "legend",
        title: "Chú giải",
        note: "Thẻ có tag, chip, agent, số đếm, liên kết, cổng ra; chú giải gồm loại, trạng thái, kiểu cạnh.",
        render: () => <FlowGraph label="Chú giải" nodes={legendNodes} edges={legendEdges} legend={FULL_LEGEND} {...common} />,
    },
    {
        id: "edges",
        title: "Kiểu cạnh",
        note: "Đã đi, dự phòng, không đi, quay lại, chỗ trống.",
        render: () => <FlowGraph label="Kiểu cạnh" nodes={edgeNodes} edges={edgeEdges} {...common} />,
    },
    {
        id: "vertical",
        title: "Chiều dọc",
        note: "direction TB: cổng ra nằm dọc cạnh dưới.",
        render: () => <FlowGraph label="Chiều dọc" nodes={legendNodes} edges={legendEdges} {...common} />,
    },
    { id: "editable", title: "Sắp xếp được", note: "editable: kéo thẻ, vị trí lưu trong positions, nút đặt lại trả về bố cục tự động.", render: () => <Editable /> },
    {
        id: "loading",
        title: "Đang tải",
        note: "Toàn khung xương, không chữ.",
        render: () => <FlowGraph label="Đang tải" nodes={statesNodes} edges={statesEdges} isLoading {...common} />,
    },
    {
        id: "schema",
        title: "Sơ đồ dữ liệu",
        note: "SchemaMap: thực thể, trường, quan hệ.",
        render: () => (
            <SchemaMap
                label="Sơ đồ dữ liệu"
                entities={entities}
                relations={[
                    { source: "order", target: "contact", label: "người mua" },
                    { source: "order", target: "product" },
                    { source: "lead", target: "contact" },
                ]}
                moreLabel={(count) => `+${String(count)} trường`}
                minimap
                minimapLabel="Tổng quan"
                {...{ ariaLabelConfig: common.ariaLabelConfig }}
            />
        ),
    },
]

export const StoryView = ({ story }: { readonly story: Story }): ReactElement => (
    <div className="demo-page">
        <h1 className="demo-title">{story.title}</h1>
        <p className="demo-note">{story.note}</p>
        {story.id === "editable" ? story.render() : <Frame label={story.id}>{story.render()}</Frame>}
    </div>
)
