// The words the gallery shows, by locale (PROJECT-GALLERY-1 item 7): `vi` and `en` have a table, any other locale reads `en`. The field names of explain.md
// (`Vì sao`, `Luật`, `Grammar`) are the owner's and stay as written in both.
export interface Labels {
    readonly title: string
    readonly counts: string
    readonly countsMatches: string
    readonly countsNotCoded: string
    readonly countsUnrecorded: string
    readonly countsDiffers: string
    readonly countsStale: string
    readonly hidden: string
    readonly width: string
    readonly view: string
    readonly viewSide: string
    readonly viewSlider: string
    readonly viewShot: string
    readonly viewDesign: string
    readonly viewCompare: string
    readonly viewOnion: string
    readonly viewDiff: string
    readonly onionOpacity: string
    readonly reasonNoDesign: string
    readonly reasonNoShot: string
    readonly statusDrafted: string
    readonly statusApproved: string
    readonly screens: string
    readonly flows: string
    readonly search: string
    readonly noScreens: string
    readonly empty: string
    readonly statusMatches: string
    readonly statusDiffers: string
    readonly statusStale: string
    readonly statusNotBuilt: string
    readonly statusUnrecorded: string
    readonly statusCodedOnly: string
    readonly unrecordedHint: string
    readonly designApproved: string
    readonly legend: string
    readonly statusNone: string
    readonly design: string
    readonly shot: string
    readonly noDesign: string
    readonly noShot: string
    readonly noShotAtWidth: string
    readonly slider: string
    readonly states: string
    readonly stateBase: string
    readonly stateDetail: string
    readonly stateEmpty: string
    readonly stateFirstVisit: string
    readonly stateLoading: string
    readonly stateError: string
    readonly stateNoMatch: string
    readonly stateEditing: string
    readonly explain: string
    readonly hideExplain: string
    readonly paneDesign: string
    readonly paneShot: string
    readonly regions: string
    readonly problems: string
    readonly close: string
    readonly zoomIn: string
    readonly zoomOut: string
    readonly zoomFit: string
    readonly openFrame: string
    readonly pane: string
    readonly showExplain: string
    readonly summary: string
    readonly codeFiles: string
    readonly sectionShows: string
    readonly sectionWhy: string
    readonly sectionActions: string
    readonly sectionStates: string
    readonly needsApi: string
    readonly considered: string
    readonly chosen: string
    readonly rejected: string
    readonly audit: string
    readonly auditBuilder: string
    readonly auditAuditor: string
    readonly auditRound: string
    readonly auditLens: string
    readonly auditNotes: string
    readonly auditNone: string
    readonly needsOwner: string
    readonly verdictPass: string
    readonly verdictFixed: string
    readonly verdictOpen: string
    readonly lensOrder: string
    readonly lensLayout: string
    readonly lensActionable: string
    readonly lensLive: string
    readonly lensWords: string
    readonly lensStates: string
    readonly lensTruth: string
    readonly flagNone: string
    readonly flagFew: string
    readonly flagOpen: string
    readonly flagOwner: string
    readonly flaggedOnly: string
    readonly flaggedCount: string
    readonly noExplain: string
    readonly noRegions: string
    readonly problemMissing: string
    readonly problemUnclear: string
    readonly intro: string
    readonly openDev: string
    readonly board: string
    readonly route: string
    readonly galleryId: string
    readonly noFlows: string
    readonly linksHeading: string
    readonly openScreen: string
    readonly clear: string
    readonly back: string
    readonly boardView: string
    readonly boardRevision: string
    readonly boardApproved: string
    readonly boardUnapproved: string
    readonly boardPlanned: string
    readonly boardNeedsApi: string
    readonly boardNoModule: string
    readonly boardOpenScreen: string
    readonly boardEmpty: string
    readonly boardSkipped: string
    readonly boardState: string
}

export const LABELS = Object.freeze({
    en: {
        title: "{app} gallery",
        counts: "{total} screens",
        countsMatches: "{n} match",
        countsNotCoded: "{n} not coded",
        countsUnrecorded: "{n} not recorded",
        countsDiffers: "{n} differ",
        countsStale: "{n} stale",
        hidden: "{n} screens hidden (no explain.md)",
        width: "Width",
        view: "View",
        viewSide: "Side by side",
        viewSlider: "Slider",
        viewShot: "Shot",
        viewDesign: "Design",
        viewCompare: "Compare",
        viewOnion: "Onion skin",
        viewDiff: "Difference",
        onionOpacity: "Shot opacity",
        reasonNoDesign: "No design frame at this width, so there is nothing to compare with.",
        reasonNoShot: "No shot at this width yet, so there is nothing to compare with.",
        statusDrafted: "Drawn, awaiting approval",
        statusApproved: "Approved, not coded",
        screens: "Screens",
        flows: "Flow map",
        search: "Search screens",
        noScreens: "No screens match.",
        empty: "No screens yet. Put the shots and explain.md in gallery/pages/<area>/<screen>/",
        statusMatches: "Matches the design",
        statusDiffers: "Built, differs",
        statusStale: "Stale shot",
        statusNotBuilt: "Drawn, not coded",
        statusUnrecorded: "Coded, not recorded",
        statusCodedOnly: "Coded, no design drawn",
        unrecordedHint: "Drawn and coded, but design.json has no entry for this page: record it (PROJECT-GALLERY-6, PROJECT-GALLERY-7).",
        designApproved: "Approved design",
        legend: "Legend",
        statusNone: "No design yet",
        design: "Design",
        shot: "Real shot",
        noDesign: "No design frame for this screen.",
        noShot: "No shot yet.",
        noShotAtWidth: "No shot at this width.",
        slider: "Compare design and shot",
        states: "States",
        stateBase: "list",
        stateDetail: "detail",
        stateEmpty: "empty",
        stateFirstVisit: "first visit",
        stateLoading: "loading",
        stateError: "error",
        stateNoMatch: "no match",
        stateEditing: "editing",
        explain: "Explanation",
        hideExplain: "Hide explanation",
        paneDesign: "Design",
        paneShot: "Shot",
        regions: "Regions",
        problems: "{n} to fix",
        close: "Close",
        zoomIn: "Zoom in",
        zoomOut: "Zoom out",
        zoomFit: "Fit",
        openFrame: "Open full size",
        pane: "Show",
        showExplain: "Show explanation",
        summary: "What it is for",
        codeFiles: "Built in",
        sectionShows: "Shows",
        sectionWhy: "Why",
        sectionActions: "Actions",
        sectionStates: "States",
        needsApi: "needs API",
        considered: "Options considered",
        chosen: "chosen",
        rejected: "rejected",
        audit: "Audit",
        auditBuilder: "Builder",
        auditAuditor: "Auditor",
        auditRound: "Round {n}",
        auditLens: "Lens",
        auditNotes: "Notes",
        auditNone: "not audited yet (grandfathered)",
        needsOwner: "Needs owner",
        verdictPass: "pass",
        verdictFixed: "fixed",
        verdictOpen: "open",
        lensOrder: "Order",
        lensLayout: "Layout",
        lensActionable: "Actionable",
        lensLive: "Live",
        lensWords: "Words",
        lensStates: "States",
        lensTruth: "Truth",
        flagNone: "no audit",
        flagFew: "fewer than 2 audit rounds",
        flagOpen: "open lens in the latest round",
        flagOwner: "needs owner",
        flaggedOnly: "Flagged only",
        flaggedCount: "{n} flagged",
        noExplain: "This screen has no explanation yet.",
        noRegions: "BUG: no region yet",
        problemMissing: "missing {field}",
        problemUnclear: "{field} is unclear or wrong",
        intro: "Overview",
        openDev: "Open on dev",
        board: "Design board",
        route: "Route",
        galleryId: "Gallery id",
        noFlows: "No flow yet. Name flows in gallery/flows.json and mark hotspots in a screen links.json.",
        linksHeading: "Links between screens",
        openScreen: "Open {to}",
        clear: "Clear",
        back: "Back to screens",
        boardView: "Board",
        boardRevision: "revision {n}",
        boardApproved: "approved {at}",
        boardUnapproved: "waiting for the owner",
        boardPlanned: "not coded yet",
        boardNeedsApi: "needs API: {op}",
        boardNoModule: "no module {file}",
        boardOpenScreen: "Open the screen",
        boardEmpty: "The board has no section yet. Add sections to gallery/board/board.yaml.",
        boardSkipped: "skipped: {list}",
        boardState: "State {state}",
    },
    vi: {
        title: "Thư viện ảnh {app}",
        counts: "{total} màn",
        countsMatches: "{n} khớp",
        countsNotCoded: "{n} chưa code",
        countsUnrecorded: "{n} chưa ghi duyệt",
        countsDiffers: "{n} lệch",
        countsStale: "{n} ảnh cũ",
        hidden: "{n} màn bị ẩn (thiếu explain.md)",
        width: "Độ rộng",
        view: "Xem",
        viewSide: "Cạnh nhau",
        viewSlider: "Trượt so",
        viewShot: "Ảnh thật",
        viewDesign: "Bản vẽ",
        viewCompare: "Đối chiếu",
        viewOnion: "Phủ mờ",
        viewDiff: "Chênh lệch",
        onionOpacity: "Độ mờ của ảnh thật",
        reasonNoDesign: "Chưa có khung bản vẽ ở độ rộng này nên chưa đối chiếu được.",
        reasonNoShot: "Chưa có ảnh ở độ rộng này nên chưa đối chiếu được.",
        statusDrafted: "Bản vẽ, chờ duyệt",
        statusApproved: "Đã duyệt, chưa code",
        screens: "Màn hình",
        flows: "Bản đồ luồng",
        search: "Tìm màn hình",
        noScreens: "Không có màn hình nào khớp.",
        empty: "Chưa có màn hình nào. Đặt ảnh và explain.md vào gallery/pages/<area>/<screen>/",
        statusMatches: "Khớp bản vẽ",
        statusDiffers: "Đã code, còn lệch",
        statusStale: "Ảnh đã cũ",
        statusNotBuilt: "Có bản vẽ, chưa code",
        statusUnrecorded: "Đã code, chưa ghi duyệt",
        statusCodedOnly: "Đã code, chưa có bản vẽ",
        unrecordedHint: "Đã có bản vẽ và đã code, nhưng design.json chưa có mục cho trang này: hãy ghi lại (PROJECT-GALLERY-6, PROJECT-GALLERY-7).",
        designApproved: "Bản vẽ đã duyệt",
        legend: "Chú giải",
        statusNone: "Chưa có bản vẽ",
        design: "Bản vẽ",
        shot: "Ảnh thật",
        noDesign: "Màn này chưa có khung vẽ.",
        noShot: "Chưa có ảnh.",
        noShotAtWidth: "Không có ảnh ở độ rộng này.",
        slider: "So bản vẽ và ảnh",
        states: "Trạng thái",
        stateBase: "danh sách",
        stateDetail: "chi tiết",
        stateEmpty: "trống",
        stateFirstVisit: "lần đầu",
        stateLoading: "đang tải",
        stateError: "lỗi",
        stateNoMatch: "không khớp",
        stateEditing: "đang soạn",
        explain: "Giải thích",
        hideExplain: "Ẩn giải thích",
        paneDesign: "Bản vẽ",
        paneShot: "Ảnh thật",
        regions: "Các vùng",
        problems: "{n} chỗ cần sửa",
        close: "Đóng",
        zoomIn: "Phóng to",
        zoomOut: "Thu nhỏ",
        zoomFit: "Vừa khung",
        openFrame: "Mở cỡ đầy đủ",
        pane: "Hiện",
        showExplain: "Hiện giải thích",
        summary: "Dùng để làm gì",
        codeFiles: "Code",
        sectionShows: "Hiển thị",
        sectionWhy: "Vì sao",
        sectionActions: "Thao tác",
        sectionStates: "Trạng thái",
        needsApi: "cần API",
        considered: "Phương án đã cân nhắc",
        chosen: "chọn",
        rejected: "bỏ",
        audit: "Audit",
        auditBuilder: "Người làm",
        auditAuditor: "Người audit",
        auditRound: "Vòng {n}",
        auditLens: "Góc nhìn",
        auditNotes: "Ghi chú",
        auditNone: "chưa audit (grandfathered)",
        needsOwner: "Cần chủ dự án quyết",
        verdictPass: "đạt",
        verdictFixed: "đã sửa",
        verdictOpen: "còn mở",
        lensOrder: "Thứ tự",
        lensLayout: "Bố cục",
        lensActionable: "Thao tác được",
        lensLive: "Trạng thái sống",
        lensWords: "Từ ngữ",
        lensStates: "Các trạng thái",
        lensTruth: "Dữ liệu thật",
        flagNone: "chưa audit",
        flagFew: "dưới 2 vòng audit",
        flagOpen: "vòng mới nhất còn góc nhìn mở",
        flagOwner: "cần chủ dự án quyết",
        flaggedOnly: "Chỉ màn cần xem",
        flaggedCount: "{n} cần xem",
        noExplain: "Màn này chưa có giải thích.",
        noRegions: "LỖI: chưa có vùng nào",
        problemMissing: "thiếu {field}",
        problemUnclear: "{field} chưa rõ hoặc sai",
        intro: "Tổng quan",
        openDev: "Mở trên dev",
        board: "Bảng thiết kế",
        route: "Route",
        galleryId: "Mã gallery",
        noFlows: "Chưa có luồng. Đặt tên luồng trong gallery/flows.json và đánh dấu vùng bấm trong links.json của màn hình.",
        linksHeading: "Liên kết giữa các màn hình",
        openScreen: "Mở {to}",
        clear: "Xóa",
        back: "Về danh sách màn",
        boardView: "Board",
        boardRevision: "bản {n}",
        boardApproved: "chủ duyệt {at}",
        boardUnapproved: "chờ chủ duyệt",
        boardPlanned: "chưa code",
        boardNeedsApi: "cần API: {op}",
        boardNoModule: "thiếu tệp vẽ {file}",
        boardOpenScreen: "Mở màn hình",
        boardEmpty: "Board chưa có mục nào. Thêm mục vào gallery/board/board.yaml.",
        boardSkipped: "bỏ qua: {list}",
        boardState: "Trạng thái {state}",
    },
} satisfies Record<string, Labels>)

/** The words of a locale (`en` when it has no table). */
export const labelsFor = (locale: string): Labels => (locale === "vi" ? LABELS.vi : LABELS.en)

/** The supported gallery language for a declared default locale (`vi-VN` reads as `vi`); `en` when the locale is undeclared or not in the table. */
export function galleryLocale(declared: string | null | undefined): string {
    const primary = (declared ?? "").trim().toLowerCase().split(/[-_]/u)[0] ?? ""
    return Object.hasOwn(LABELS, primary) ? primary : "en"
}

export const fill = (text: string, values: Readonly<Record<string, string | number>>): string => text.replace(/\{(\w+)\}/gu, (_all, key: string) => String(values[key] ?? ""))

/** A label for display with its first letter in capitals, by the locale's own rules (`đăng nhập` reads `Đăng nhập`); the folder name or id it came from is never changed. */
export function capitalize(text: string, locale: string): string {
    const [first = ""] = text
    return first === "" ? text : first.toLocaleUpperCase(locale) + text.slice(first.length)
}
