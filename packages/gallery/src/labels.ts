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
}

export const LABELS = Object.freeze({
    en: {
        title: "{app} gallery",
        counts: "{total} screens",
        countsMatches: "{n} match",
        countsNotCoded: "{n} not coded",
        countsUnrecorded: "{n} coded, not recorded",
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
    },
    vi: {
        title: "Thư viện ảnh {app}",
        counts: "{total} màn",
        countsMatches: "{n} khớp",
        countsNotCoded: "{n} chưa code",
        countsUnrecorded: "{n} đã code chưa ghi duyệt",
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
