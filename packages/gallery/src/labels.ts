// The words the gallery shows, by locale (PROJECT-GALLERY-1 item 7): `vi` and `en` have a table, any other locale reads `en`. The field names of explain.md
// (`Vì sao`, `Luật`, `Grammar`) are the owner's and stay as written in both.
export interface Labels {
    readonly title: string
    readonly counts: string
    readonly countsMatches: string
    readonly countsNotBuilt: string
    readonly countsDiffers: string
    readonly countsStale: string
    readonly hidden: string
    readonly width: string
    readonly view: string
    readonly viewSide: string
    readonly viewSlider: string
    readonly viewShot: string
    readonly screens: string
    readonly flows: string
    readonly search: string
    readonly noScreens: string
    readonly empty: string
    readonly statusMatches: string
    readonly statusDiffers: string
    readonly statusStale: string
    readonly statusNotBuilt: string
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
        countsNotBuilt: "{n} not built",
        countsDiffers: "{n} differ",
        countsStale: "{n} stale",
        hidden: "{n} screens hidden (no explain.md)",
        width: "Width",
        view: "View",
        viewSide: "Side by side",
        viewSlider: "Slider",
        viewShot: "Shot only",
        screens: "Screens",
        flows: "Flow map",
        search: "Search screens",
        noScreens: "No screens match.",
        empty: "No screens yet. Put the shots and explain.md in gallery/pages/<area>/<screen>/",
        statusMatches: "Matches the design",
        statusDiffers: "Built, differs",
        statusStale: "Stale shot",
        statusNotBuilt: "Not built",
        statusNone: "Not designed",
        design: "Approved design",
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
        countsNotBuilt: "{n} chưa code",
        countsDiffers: "{n} lệch",
        countsStale: "{n} ảnh cũ",
        hidden: "{n} màn bị ẩn (thiếu explain.md)",
        width: "Độ rộng",
        view: "Xem",
        viewSide: "Cạnh nhau",
        viewSlider: "Trượt so",
        viewShot: "Chỉ ảnh",
        screens: "Màn hình",
        flows: "Bản đồ luồng",
        search: "Tìm màn hình",
        noScreens: "Không có màn hình nào khớp.",
        empty: "Chưa có màn hình nào. Đặt ảnh và explain.md vào gallery/pages/<area>/<screen>/",
        statusMatches: "Khớp bản vẽ",
        statusDiffers: "Đã code, còn lệch",
        statusStale: "Ảnh đã cũ",
        statusNotBuilt: "Chưa code",
        statusNone: "Chưa có bản vẽ",
        design: "Bản vẽ đã duyệt",
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
