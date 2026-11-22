import type { ReactElement } from "react"
import { KnowledgeMap, type KnowledgeCluster, type KnowledgeItem, type KnowledgeKind, type KnowledgeLegendItem, type KnowledgeMapProps, type KnowledgeState } from "../../src/core/ext/graph/index.ts"

/** The words of the demo, as an app would pass them in its own language. */
const WORDS = {
    zoomLabels: { zoomIn: "Phóng to", zoomOut: "Thu nhỏ", fit: "Vừa khung" },
    kindLabels: { document: "Tài liệu", fact: "Dữ kiện" },
    stateLabels: { ready: "Đã dùng được", pending: "Đang đọc", stale: "Đã cũ", error: "Đọc lỗi" },
    weightLabel: (weight: number): string => `${String(weight)} lượt dùng`,
    sourceLabel: "Từ",
    emptyLabel: "Chưa có kiến thức nào",
    onOpen: (id: string): void => {
        Object.assign(window, { knowledgeOpened: id })
    },
} satisfies Partial<KnowledgeMapProps>

const LEGEND: KnowledgeLegendItem[] = [
    { label: "Tài liệu", kind: "document" },
    { label: "Dữ kiện", kind: "fact" },
    { label: "Dữ kiện đọc từ tài liệu", source: true },
    { label: "Đã dùng được", state: "ready" },
    { label: "Đang đọc", state: "pending" },
    { label: "Đã cũ", state: "stale" },
    { label: "Đọc lỗi", state: "error" },
]

type Row = readonly [id: string, name: string, kind: KnowledgeKind, weight: number, source?: string | undefined, state?: KnowledgeState]

const place = (clusterId: string, rows: readonly Row[]): KnowledgeItem[] =>
    rows.map(([id, name, kind, weight, source, state]) => ({ id, name, kind, clusterId, weight, ...(source === undefined ? {} : { sourceId: source }), ...(state === undefined ? {} : { state }) }))

const BRAIN_CLUSTERS: KnowledgeCluster[] = [
    { id: "sales", name: "Chính sách bán hàng" },
    { id: "price", name: "Sản phẩm và giá" },
    { id: "care", name: "Chăm sóc khách hàng" },
    { id: "stock", name: "Vận hành kho" },
    { id: "brand", name: "Giọng thương hiệu" },
    { id: "legal", name: "Pháp lý và hợp đồng" },
]

const BRAIN_ITEMS: KnowledgeItem[] = [
    ...place("sales", [
        ["s-doc1", "Quy trình chốt đơn", "document", 48, undefined, "ready"],
        ["s-doc2", "Bảng chiết khấu đại lý", "document", 22, undefined, "ready"],
        ["s-f1", "Giảm 10% đơn từ 5 triệu", "fact", 31, "s-doc2", "ready"],
        ["s-f2", "Đại lý cấp 1 được trả chậm 30 ngày", "fact", 14, "s-doc2"],
        ["s-f3", "Đơn gấp giao trong 24 giờ", "fact", 19, "s-doc1", "ready"],
        ["s-f4", "Không giảm giá hàng mới về", "fact", 9, "s-doc1", "stale"],
        ["s-f5", "Báo giá có hiệu lực 7 ngày", "fact", 12, "s-doc1"],
    ]),
    ...place("price", [
        ["p-doc1", "Bảng giá quý 4", "document", 64, undefined, "ready"],
        ["p-doc2", "Thông số sản phẩm", "document", 37, undefined, "pending"],
        ["p-f1", "Gói Cơ bản 1,2 triệu mỗi tháng", "fact", 52, "p-doc1", "ready"],
        ["p-f2", "Gói Nâng cao 3,5 triệu mỗi tháng", "fact", 41, "p-doc1", "ready"],
        ["p-f3", "Bảo hành 12 tháng", "fact", 26, "p-doc2"],
        ["p-f4", "Pin dùng được 9 giờ", "fact", 8, "p-doc2", "pending"],
        ["p-f5", "Màu đen và trắng", "fact", 5, "p-doc2"],
        ["p-f6", "Miễn phí lắp đặt nội thành", "fact", 17, "p-doc1"],
    ]),
    ...place("care", [
        ["c-doc1", "Kịch bản trả lời khách", "document", 58, undefined, "ready"],
        ["c-doc2", "Câu hỏi thường gặp", "document", 44, undefined, "ready"],
        ["c-f1", "Trả lời trong 15 phút giờ hành chính", "fact", 33, "c-doc1", "ready"],
        ["c-f2", "Khách phàn nàn chuyển cho quản lý", "fact", 11, "c-doc1"],
        ["c-f3", "Đổi trả trong 7 ngày", "fact", 46, "c-doc2", "ready"],
        ["c-f4", "Hoàn tiền về tài khoản gốc", "fact", 15, "c-doc2", "error"],
        ["c-f5", "Xin lỗi trước, giải thích sau", "fact", 7, "c-doc1"],
    ]),
    ...place("stock", [
        ["k-doc1", "Quy định xuất nhập kho", "document", 18, undefined, "ready"],
        ["k-f1", "Kiểm đếm cuối ngày", "fact", 10, "k-doc1"],
        ["k-f2", "Kho HCM giữ tồn tối thiểu 40 cái", "fact", 13, "k-doc1", "stale"],
        ["k-f3", "Hàng lỗi để riêng khu B", "fact", 6, "k-doc1"],
        ["k-f4", "Giao hàng trước 17 giờ", "fact", 21, "k-doc1", "ready"],
    ]),
    ...place("brand", [
        ["b-doc1", "Cẩm nang giọng nói", "document", 29, undefined, "ready"],
        ["b-f1", "Xưng em, gọi khách là anh hoặc chị", "fact", 35, "b-doc1", "ready"],
        ["b-f2", "Không dùng từ lóng", "fact", 12, "b-doc1"],
        ["b-f3", "Câu ngắn, rõ ý", "fact", 16, "b-doc1"],
        ["b-f4", "Biểu tượng cảm xúc tối đa hai", "fact", 4, "b-doc1"],
    ]),
    ...place("legal", [
        ["l-doc1", "Mẫu hợp đồng đại lý", "document", 12, undefined, "ready"],
        ["l-f1", "Thời hạn hợp đồng 12 tháng", "fact", 9, "l-doc1"],
        ["l-f2", "Phạt vi phạm 8%", "fact", 3, "l-doc1", "pending"],
        ["l-f3", "Tranh chấp giải quyết tại Hồ Chí Minh", "fact", 2, "l-doc1"],
    ]),
]

const SPARSE_CLUSTERS: KnowledgeCluster[] = [
    { id: "a", name: "Giá bán" },
    { id: "b", name: "Giao hàng" },
]
const SPARSE_ITEMS: KnowledgeItem[] = [
    ...place("a", [
        ["a1", "Bảng giá tháng này", "document", 20, undefined, "ready"],
        ["a2", "Gói Cơ bản 1,2 triệu", "fact", 12, "a1"],
        ["a3", "Gói Nâng cao 3,5 triệu", "fact", 7, "a1"],
    ]),
    ...place("b", [
        ["b1", "Quy định giao hàng", "document", 9, undefined, "pending"],
        ["b2", "Giao trong 24 giờ", "fact", 5, "b1"],
    ]),
]

const LONG_CLUSTERS: KnowledgeCluster[] = [
    { id: "x", name: "Chính sách đổi trả và bảo hành cho khách mua trực tuyến" },
    { id: "y", name: "Hướng dẫn xử lý khiếu nại của khách hàng doanh nghiệp lớn" },
    { id: "z", name: "Quy định giao nhận và đối soát với đơn vị vận chuyển" },
]
const LONG_ITEMS: KnowledgeItem[] = [
    ...place("x", [
        ["x1", "Quy trình tiếp nhận yêu cầu đổi trả hàng hoá từ khách mua qua trang bán hàng trực tuyến", "document", 40, undefined, "ready"],
        ["x2", "Sản phẩm điện tử được bảo hành tại trung tâm uỷ quyền trong vòng mười hai tháng kể từ ngày mua", "fact", 22, "x1", "ready"],
        ["x3", "Khách được hoàn lại toàn bộ chi phí vận chuyển nếu lỗi thuộc về cửa hàng", "fact", 15, "x1"],
        ["x4", "Hàng đã qua sử dụng không được đổi", "fact", 9, "x1", "stale"],
        ["x5", "Tem bảo hành phải còn nguyên vẹn", "fact", 6, "x1"],
    ]),
    ...place("y", [
        ["y1", "Biểu mẫu ghi nhận và phân loại khiếu nại theo mức độ nghiêm trọng", "document", 26, undefined, "ready"],
        ["y2", "Khiếu nại nghiêm trọng phải được giám đốc chăm sóc khách hàng phản hồi trong hai giờ", "fact", 18, "y1", "pending"],
        ["y3", "Mọi cuộc gọi khiếu nại đều được ghi âm để đối chiếu về sau", "fact", 8, "y1"],
        ["y4", "Bồi thường tối đa bằng giá trị đơn hàng", "fact", 11, "y1", "error"],
    ]),
    ...place("z", [
        ["z1", "Hợp đồng nguyên tắc với đơn vị vận chuyển giao nhanh toàn quốc", "document", 14, undefined, "ready"],
        ["z2", "Đối soát phí thu hộ vào ngày mười lăm hằng tháng", "fact", 10, "z1"],
        ["z3", "Thất lạc hàng được đền theo giá khai báo, tối đa năm triệu đồng", "fact", 5, "z1", "ready"],
        ["z4", "Đơn giao thất bại hai lần tự động hoàn về kho", "fact", 7, "z1"],
    ]),
]

const DOCS_CLUSTERS: KnowledgeCluster[] = [
    { id: "start", name: "Getting started" },
    { id: "api", name: "API reference" },
    { id: "guides", name: "Guides" },
    { id: "ops", name: "Operations" },
]
const DOCS_ITEMS: KnowledgeItem[] = [
    ...place("start", [
        ["d-install", "Installation", "document", 90, undefined, "ready"],
        ["d-quick", "Quickstart", "document", 120, undefined, "ready"],
        ["d-node", "Requires Node 20 or newer", "fact", 40, "d-install"],
        ["d-pm", "Works with npm, pnpm and yarn", "fact", 22, "d-install"],
        ["d-first", "First request in five minutes", "fact", 35, "d-quick"],
    ]),
    ...place("api", [
        ["a-auth", "Authentication", "document", 70, undefined, "ready"],
        ["a-rate", "Rate limits", "document", 45, undefined, "pending"],
        ["a-keys", "Keys are sent in a header", "fact", 38, "a-auth"],
        ["a-tok", "Tokens expire after one hour", "fact", 30, "a-auth", "stale"],
        ["a-429", "429 means slow down", "fact", 18, "a-rate"],
        ["a-burst", "Bursts of 50 per second", "fact", 12, "a-rate"],
    ]),
    ...place("guides", [
        ["g-hooks", "Webhooks", "document", 55, undefined, "ready"],
        ["g-retry", "Retries are signed and repeated", "fact", 20, "g-hooks"],
        ["g-test", "Test with the local tunnel", "fact", 14, "g-hooks"],
        ["g-mig", "Migrating from v1", "document", 33, undefined, "error"],
        ["g-ids", "Identifiers changed shape", "fact", 16, "g-mig"],
    ]),
    ...place("ops", [
        ["o-stat", "Status page", "document", 25, undefined, "ready"],
        ["o-sla", "99.9% uptime target", "fact", 21, "o-stat"],
        ["o-win", "Maintenance on Sundays", "fact", 6, "o-stat"],
    ]),
]
const DOCS_WORDS = {
    zoomLabels: { zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit to view" },
    kindLabels: { document: "Page", fact: "Detail" },
    stateLabels: { ready: "Up to date", pending: "Being updated", stale: "Out of date", error: "Failed to build" },
    weightLabel: (weight: number): string => `${String(weight)} visits`,
    sourceLabel: "From",
    onOpen: WORDS.onOpen,
} satisfies Partial<KnowledgeMapProps>

export interface KnowledgeStory {
    readonly id: string
    readonly title: string
    readonly note: string
    readonly render: () => ReactElement
}

export const KNOWLEDGE_STORIES: readonly KnowledgeStory[] = [
    {
        id: "knowledge-brain",
        title: "Bản đồ kiến thức",
        note: "Kho kiến thức của một doanh nghiệp: sáu chủ đề, hơn ba mươi bong bóng; kích thước theo số lượt dùng, đường nối dữ kiện với tài liệu nguồn.",
        render: () => <KnowledgeMap label="Bản đồ kiến thức" clusters={BRAIN_CLUSTERS} items={BRAIN_ITEMS} legend={LEGEND} {...WORDS} />,
    },
    {
        id: "knowledge-docs",
        title: "Topics of a docs site",
        note: "The same component for any app: pages and details of a documentation site, in English, sized by visits.",
        render: () => <KnowledgeMap label="Topics of a docs site" clusters={DOCS_CLUSTERS} items={DOCS_ITEMS} {...DOCS_WORDS} />,
    },
    {
        id: "knowledge-sparse",
        title: "Bản đồ thưa",
        note: "Hai chủ đề, vài bong bóng.",
        render: () => <KnowledgeMap label="Bản đồ thưa" clusters={SPARSE_CLUSTERS} items={SPARSE_ITEMS} legend={LEGEND} {...WORDS} />,
    },
    {
        id: "knowledge-long",
        title: "Tên dài",
        note: "Tên chủ đề và tên bong bóng bằng tiếng Việt rất dài.",
        render: () => <KnowledgeMap label="Tên dài" clusters={LONG_CLUSTERS} items={LONG_ITEMS} legend={LEGEND} {...WORDS} />,
    },
    {
        id: "knowledge-loading",
        title: "Đang tải",
        note: "Toàn khung xương, không chữ.",
        render: () => <KnowledgeMap label="Đang tải" clusters={BRAIN_CLUSTERS} items={BRAIN_ITEMS} isLoading {...WORDS} />,
    },
    {
        id: "knowledge-empty",
        title: "Chưa có kiến thức",
        note: "Không có bong bóng nào.",
        render: () => <KnowledgeMap label="Chưa có kiến thức" clusters={BRAIN_CLUSTERS} items={[]} {...WORDS} />,
    },
]
