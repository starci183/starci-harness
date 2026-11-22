import "./erd.css"
import type { IconSource } from "../../src/common/index.ts"
import { useState, type ReactElement, type ReactNode } from "react"
import { ErdMap, type ErdEntity, type ErdField, type ErdRelation } from "../../src/core/ext/graph/index.ts"

/** The ERD stories of the demo: the words are the app's, here Vietnamese. */
/** An outline glyph as the app's own icon component (a Grammar `IconSource`). */
const glyph =
    (d: string): IconSource =>
    (props) => (
        <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={d} />
        </svg>
    )
const person = glyph("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0")
const bag = glyph("M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0")
const list = glyph("M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01")
const box = glyph("M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8")
const clock = glyph("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2")
const wrench = glyph("M14 6a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3z")
const folder = glyph("M4 6h6l2 2h8v10H4z")
const building = glyph("M5 21V4h9v17M14 9h5v12M9 8h1M9 12h1M9 16h1")
const tag = glyph("M4 4h8l8 8-8 8-8-8z")
const card = glyph("M3 6h18v12H3zM3 10h18")

const TEXT = "chữ"
const NUMBER = "số"
const MONEY = "tiền"
const DATE = "ngày"
const CHOICE = "chọn"
const f = (id: string, label: string, type?: string): ErdField => (type === undefined ? { id, label } : { id, label, type })

const COMMON = {
    ariaLabelConfig: { "controls.zoomIn.ariaLabel": "Phóng to", "controls.zoomOut.ariaLabel": "Thu nhỏ", "controls.fitView.ariaLabel": "Vừa khung" },
    moreLabel: (count: number) => `+${String(count)} trường`,
} as const

const shop: ErdEntity[] = [
    { id: "customer", label: "Khách hàng", count: "1.280 bản ghi", icon: person, fields: [f("name", "Họ tên", TEXT), f("phone", "Số điện thoại", TEXT), f("tier", "Hạng thành viên", CHOICE), f("since", "Ngày đăng ký", DATE)] },
    { id: "order", label: "Đơn hàng", count: "342 bản ghi", icon: bag, fields: [f("code", "Mã đơn", TEXT), f("buyer", "Người mua"), f("total", "Tổng tiền", MONEY), f("status", "Trạng thái", CHOICE)] },
    { id: "line", label: "Dòng đơn", count: "1.046 bản ghi", icon: list, fields: [f("order", "Đơn hàng"), f("item", "Sản phẩm"), f("qty", "Số lượng", NUMBER), f("price", "Đơn giá", MONEY)] },
    { id: "product", label: "Sản phẩm", count: "56 bản ghi", icon: box, fields: [f("sku", "Mã hàng", TEXT), f("title", "Tên sản phẩm", TEXT), f("cost", "Giá bán", MONEY)] },
    { id: "booking", label: "Lịch hẹn", count: "208 bản ghi", icon: clock, fields: [f("client", "Khách hàng"), f("treat", "Dịch vụ"), f("at", "Giờ hẹn", DATE)] },
    { id: "service", label: "Dịch vụ", count: "14 bản ghi", icon: wrench, fields: [f("title", "Tên dịch vụ", TEXT), f("minutes", "Thời lượng", NUMBER), f("fee", "Phí", MONEY)] },
]
const shopRelations: ErdRelation[] = [
    { source: "order", field: "buyer", target: "customer", label: "1 khách · nhiều đơn" },
    { source: "line", field: "order", target: "order", label: "1 đơn · nhiều dòng" },
    { source: "line", field: "item", target: "product", label: "1 sản phẩm · nhiều dòng" },
    { source: "booking", field: "client", target: "customer", label: "1 khách · nhiều lịch" },
    { source: "booking", field: "treat", target: "service", label: "1 dịch vụ · nhiều lịch", to: { optional: true } },
]

const selfEntities: ErdEntity[] = [
    { id: "staff", label: "Nhân viên", count: "48 bản ghi", icon: person, fields: [f("name", "Họ tên", TEXT), f("boss", "Quản lý trực tiếp"), f("unit", "Phòng ban"), f("join", "Ngày vào làm", DATE)] },
    { id: "unit", label: "Phòng ban", count: "7 bản ghi", icon: building, fields: [f("title", "Tên phòng", TEXT), f("floor", "Tầng", NUMBER)] },
]
const selfRelations: ErdRelation[] = [
    { source: "staff", field: "boss", target: "staff", label: "1 quản lý · nhiều nhân viên", to: { optional: true } },
    { source: "staff", field: "unit", target: "unit", label: "1 phòng · nhiều người" },
]

const big: ErdEntity[] = [
    { id: "customer", label: "Khách hàng", count: "1.280 bản ghi", icon: person, fields: [f("name", "Họ tên", TEXT), f("branch", "Chi nhánh"), f("tier", "Hạng", CHOICE)] },
    { id: "contact", label: "Liên hệ", count: "2.904 bản ghi", icon: person, fields: [f("name", "Tên", TEXT), f("who", "Khách hàng"), f("phone", "Điện thoại", TEXT)] },
    { id: "order", label: "Đơn hàng", count: "342 bản ghi", icon: bag, fields: [f("buyer", "Người mua"), f("sale", "Khuyến mãi"), f("staff", "Nhân viên bán"), f("total", "Tổng tiền", MONEY)] },
    { id: "line", label: "Dòng đơn", count: "1.046 bản ghi", icon: list, fields: [f("order", "Đơn hàng"), f("item", "Sản phẩm"), f("qty", "Số lượng", NUMBER)] },
    { id: "product", label: "Sản phẩm", count: "56 bản ghi", icon: box, fields: [f("title", "Tên", TEXT), f("group", "Danh mục"), f("maker", "Nhà cung cấp")] },
    { id: "group", label: "Danh mục", count: "12 bản ghi", icon: folder, fields: [f("title", "Tên", TEXT)] },
    { id: "maker", label: "Nhà cung cấp", count: "9 bản ghi", icon: building, fields: [f("title", "Tên", TEXT), f("phone", "Điện thoại", TEXT)] },
    { id: "stock", label: "Tồn kho", count: "56 bản ghi", icon: box, fields: [f("item", "Sản phẩm"), f("depot", "Kho"), f("qty", "Số lượng", NUMBER)] },
    { id: "depot", label: "Kho", count: "3 bản ghi", icon: building, fields: [f("title", "Tên kho", TEXT), f("branch", "Chi nhánh")] },
    { id: "receipt", label: "Phiếu nhập", count: "88 bản ghi", icon: list, fields: [f("maker", "Nhà cung cấp"), f("depot", "Kho"), f("day", "Ngày nhập", DATE)] },
    { id: "booking", label: "Lịch hẹn", count: "208 bản ghi", icon: clock, fields: [f("client", "Khách hàng"), f("treat", "Dịch vụ"), f("staff", "Nhân viên")] },
    { id: "service", label: "Dịch vụ", count: "14 bản ghi", icon: wrench, fields: [f("title", "Tên", TEXT), f("fee", "Phí", MONEY)] },
    { id: "staff", label: "Nhân viên", count: "48 bản ghi", icon: person, fields: [f("name", "Họ tên", TEXT), f("branch", "Chi nhánh")] },
    { id: "branch", label: "Chi nhánh", count: "4 bản ghi", icon: building, fields: [f("title", "Tên", TEXT), f("city", "Thành phố", TEXT)] },
    { id: "invoice", label: "Hóa đơn", count: "330 bản ghi", icon: card, fields: [f("order", "Đơn hàng"), f("total", "Tổng tiền", MONEY)] },
    { id: "payment", label: "Thanh toán", count: "351 bản ghi", icon: card, fields: [f("invoice", "Hóa đơn"), f("paid", "Số tiền", MONEY), f("way", "Hình thức", CHOICE)] },
    { id: "sale", label: "Khuyến mãi", count: "6 bản ghi", icon: tag, fields: [f("title", "Tên", TEXT), f("off", "Giảm", NUMBER)] },
]
const bigRelations: ErdRelation[] = [
    { source: "customer", field: "branch", target: "branch", label: "1 chi nhánh · nhiều khách" },
    { source: "contact", field: "who", target: "customer", label: "1 khách · nhiều liên hệ" },
    { source: "order", field: "buyer", target: "customer", label: "1 khách · nhiều đơn" },
    { source: "order", field: "sale", target: "sale", label: "1 khuyến mãi · nhiều đơn", to: { optional: true } },
    { source: "order", field: "staff", target: "staff", label: "1 nhân viên · nhiều đơn" },
    { source: "line", field: "order", target: "order", label: "1 đơn · nhiều dòng" },
    { source: "line", field: "item", target: "product", label: "1 sản phẩm · nhiều dòng" },
    { source: "product", field: "group", target: "group", label: "1 danh mục · nhiều sản phẩm" },
    { source: "product", field: "maker", target: "maker", label: "1 nhà cung cấp · nhiều sản phẩm" },
    { source: "stock", field: "item", target: "product", label: "1 sản phẩm · nhiều kho" },
    { source: "stock", field: "depot", target: "depot", label: "1 kho · nhiều dòng" },
    { source: "depot", field: "branch", target: "branch", label: "1 chi nhánh · nhiều kho" },
    { source: "receipt", field: "maker", target: "maker", label: "1 nhà cung cấp · nhiều phiếu" },
    { source: "receipt", field: "depot", target: "depot", label: "1 kho · nhiều phiếu" },
    { source: "booking", field: "client", target: "customer", label: "1 khách · nhiều lịch" },
    { source: "booking", field: "treat", target: "service", label: "1 dịch vụ · nhiều lịch" },
    { source: "booking", field: "staff", target: "staff", label: "1 nhân viên · nhiều lịch" },
    { source: "staff", field: "branch", target: "branch", label: "1 chi nhánh · nhiều người" },
    { source: "invoice", field: "order", target: "order", label: "1 đơn · 1 hóa đơn", to: { many: false }, from: { many: false, optional: true } },
    { source: "payment", field: "invoice", target: "invoice", label: "1 hóa đơn · nhiều lần trả" },
]

const long: ErdEntity[] = [
    { id: "request", label: "Phiếu đề nghị thanh toán tạm ứng công tác", count: "1.204 bản ghi", icon: card, fields: [f("applicant", "Người đề nghị thanh toán và nhận tạm ứng"), f("plan", "Kế hoạch công tác đã được duyệt"), f("amount", "Tổng số tiền đề nghị tạm ứng", MONEY), f("note", "Ghi chú của kế toán trưởng về chứng từ còn thiếu", TEXT)] },
    { id: "person", label: "Cán bộ công nhân viên toàn công ty", count: "812 bản ghi", icon: person, fields: [f("name", "Họ và tên đầy đủ theo giấy tờ", TEXT), f("phone", "Số điện thoại liên hệ của người nhận hàng", TEXT), f("join", "Ngày bắt đầu làm việc chính thức", DATE)] },
    { id: "plan", label: "Kế hoạch công tác ngắn hạn", count: "96 bản ghi", icon: list, fields: [f("title", "Tên kế hoạch công tác ngắn hạn", TEXT), f("leader", "Người phụ trách chính của chuyến công tác")] },
]
const longRelations: ErdRelation[] = [
    { source: "request", field: "applicant", target: "person", label: "mỗi cán bộ có nhiều phiếu đề nghị thanh toán" },
    { source: "request", field: "plan", target: "plan", label: "một kế hoạch · nhiều phiếu", to: { optional: true } },
    { source: "plan", field: "leader", target: "person", label: "một cán bộ phụ trách nhiều kế hoạch" },
]

const library: ErdEntity[] = [
    { id: "book", label: "Sách", count: "4.120 bản ghi", icon: glyph("M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM8 17h11"), fields: [f("title", "Nhan đề", TEXT), f("writer", "Tác giả"), f("year", "Năm xuất bản", NUMBER), f("shelf", "Kệ", CHOICE)] },
    { id: "writer", label: "Tác giả", count: "860 bản ghi", icon: glyph("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"), fields: [f("name", "Họ tên", TEXT), f("born", "Năm sinh", NUMBER)] },
    { id: "loan", label: "Mượn", count: "12.300 bản ghi", icon: glyph("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"), fields: [f("copy", "Sách"), f("reader", "Bạn đọc"), f("due", "Hạn trả", DATE)] },
    { id: "reader", label: "Bạn đọc", count: "2.050 bản ghi", icon: glyph("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"), fields: [f("name", "Họ tên", TEXT), f("card", "Số thẻ", TEXT)] },
]
const libraryRelations: ErdRelation[] = [
    { source: "book", field: "writer", target: "writer", label: "1 tác giả · nhiều sách" },
    { source: "loan", field: "copy", target: "book", label: "1 sách · nhiều lượt mượn" },
    { source: "loan", field: "reader", target: "reader", label: "1 bạn đọc · nhiều lượt mượn" },
]

interface ErdStory {
    readonly id: string
    readonly title: string
    readonly note: string
    readonly render: () => ReactElement
}

const Pressed = ({ children }: { readonly children: (open: (type: string) => void) => ReactNode }): ReactElement => {
    const [opened, setOpened] = useState("")
    return (
        <>
            {children(setOpened)}
            <span data-testid="opened" hidden>
                {opened}
            </span>
        </>
    )
}

const story = (id: string, title: string, note: string, entities: ErdEntity[], relations: ErdRelation[]): ErdStory => ({
    id,
    title,
    note,
    render: () => (
        <Pressed>{(open) => <ErdMap label={title} entities={entities} relations={relations} onOpen={open} {...COMMON} />}</Pressed>
    ),
})

/** Each story with how many edge crossings its collision run may count (the default is 0). */
export const ERD_STORIES: readonly ErdStory[] = [
    story("erd-shop", "Sơ đồ dữ liệu: cửa hàng", "Khách hàng, Đơn hàng, Dòng đơn, Sản phẩm, Lịch hẹn, Dịch vụ.", shop, shopRelations),
    story("erd-library", "Sơ đồ dữ liệu: thư viện", "Ví dụ trung tính: Sách, Tác giả, Bạn đọc, Mượn.", library, libraryRelations),
    story("erd-self", "Sơ đồ dữ liệu: tự liên kết", "Một nhân viên có người quản lý cũng là nhân viên.", selfEntities, selfRelations),
    story("erd-big", "Sơ đồ dữ liệu: 17 loại", "Một hệ thống đủ lớn: bán hàng, kho, lịch hẹn, thanh toán.", big, bigRelations),
    story("erd-long", "Sơ đồ dữ liệu: tên trường dài", "Tên tiếng Việt dài: cắt bằng dấu ba chấm, đủ chữ khi rê vào.", long, longRelations),
    {
        id: "erd-loading",
        title: "Sơ đồ dữ liệu: đang tải",
        note: "Toàn khung xương, không chữ.",
        render: () => <ErdMap label="Đang tải" entities={shop} relations={shopRelations} isLoading {...COMMON} />,
    },
]

export const ERD_CROSSINGS: Readonly<Record<string, number>> = { "erd-shop": 0, "erd-library": 0, "erd-self": 0, "erd-big": 40, "erd-long": 2 }
