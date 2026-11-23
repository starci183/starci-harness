import { createElement, type ReactElement, type SVGProps } from "react"

/*
 * THE ONE ICON SET (owner 2026-11-23): Tabler outline, drawn from @tabler/icons 3.52.0 (MIT, Copyright (c) 2020-2024 Paweł Kuna,
 * https://github.com/tabler/tabler-icons). Generated, one export per glyph Grammar draws itself; an app takes the rest of the set from
 * `@tabler/icons-react`. Every glyph is outline on the 24 grid; its stroke is never written here: `.starci-core-icon` sets
 * `stroke-width` from `--grammar-icon-stroke`, the weight of the text it stands with (ramps.css "THE ICON STROKE").
 */
/** A glyph component: any SVG props in, so a part can pass its own class and aria attributes; an IconSource wherever one is taken. */
export type TablerGlyph = (props: SVGProps<SVGSVGElement>) => ReactElement

const tabler = (paths: readonly string[]): TablerGlyph => {
    const Glyph = (props: SVGProps<SVGSVGElement>): ReactElement =>
        createElement(
            "svg",
            { ...props, xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", focusable: "false" },
            ...paths.map((d, index) => createElement("path", { key: index, d })),
        )
    return Glyph
}

/** Tabler `dots`. */
export const TablerDots = tabler(["M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"])

/** Tabler `dots-vertical`. */
export const TablerDotsVertical = tabler(["M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M11 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M11 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"])

/** Tabler `send`. */
export const TablerSend = tabler(["M10 14l11 -11","M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5"])

/** Tabler `layout-sidebar-right`. */
export const TablerLayoutSidebarRight = tabler(["M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12","M15 4l0 16"])

/** Tabler `pencil`. */
export const TablerPencil = tabler(["M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4","M13.5 6.5l4 4"])

/** Tabler `x`. */
export const TablerX = tabler(["M18 6l-12 12","M6 6l12 12"])

/** Tabler `search`. */
export const TablerSearch = tabler(["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0","M21 21l-6 -6"])

/** Tabler `arrow-right`. */
export const TablerArrowRight = tabler(["M5 12l14 0","M13 18l6 -6","M13 6l6 6"])

/** Tabler `arrow-left`. */
export const TablerArrowLeft = tabler(["M5 12l14 0","M5 12l6 6","M5 12l6 -6"])

/** Tabler `chevron-right`. */
export const TablerChevronRight = tabler(["M9 6l6 6l-6 6"])

/** Tabler `chevron-left`. */
export const TablerChevronLeft = tabler(["M15 6l-6 6l6 6"])

/** Tabler `chevron-down`. */
export const TablerChevronDown = tabler(["M6 9l6 6l6 -6"])

/** Tabler `inbox`. */
export const TablerInbox = tabler(["M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12","M4 13h3l3 3h4l3 -3h3"])

/** Tabler `plus`. */
export const TablerPlus = tabler(["M12 5l0 14","M5 12l14 0"])

/** Tabler `minus`. */
export const TablerMinus = tabler(["M5 12l14 0"])

/** Tabler `upload`. */
export const TablerUpload = tabler(["M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2","M7 9l5 -5l5 5","M12 4l0 12"])

/** Tabler `download`. */
export const TablerDownload = tabler(["M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2","M7 11l5 5l5 -5","M12 4l0 12"])

/** Tabler `external-link`. */
export const TablerExternalLink = tabler(["M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6","M11 13l9 -9","M15 4h5v5"])

/** Tabler `info-circle`. */
export const TablerInfoCircle = tabler(["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0","M12 9h.01","M11 12h1v4h1"])

/** Tabler `circle-check`. */
export const TablerCircleCheck = tabler(["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0","M9 12l2 2l4 -4"])

/** Tabler `circle-x`. */
export const TablerCircleX = tabler(["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0","M10 10l4 4m0 -4l-4 4"])

/** Tabler `alert-triangle`. */
export const TablerAlertTriangle = tabler(["M12 9v4","M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0","M12 16h.01"])

/** Tabler `alert-circle`. */
export const TablerAlertCircle = tabler(["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0","M12 8v4","M12 16h.01"])

/** Tabler `bell`. */
export const TablerBell = tabler(["M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6","M9 17v1a3 3 0 0 0 6 0v-1"])

/** Tabler `menu-2`. */
export const TablerMenu2 = tabler(["M4 6l16 0","M4 12l16 0","M4 18l16 0"])

/** Tabler `paperclip`. */
export const TablerPaperclip = tabler(["M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5"])

/** Tabler `pin`. */
export const TablerPin = tabler(["M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4","M9 15l-4.5 4.5","M14.5 4l5.5 5.5"])

/** Tabler `check`. */
export const TablerCheck = tabler(["M5 12l5 5l10 -10"])

/** Tabler `photo`. */
export const TablerPhoto = tabler(["M15 8h.01","M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12","M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5","M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3"])

/** Tabler `arrows-maximize`. */
export const TablerArrowsMaximize = tabler(["M16 4l4 0l0 4","M14 10l6 -6","M8 20l-4 0l0 -4","M4 20l6 -6","M16 20l4 0l0 -4","M14 14l6 6","M8 4l-4 0l0 4","M4 4l6 6"])

/** Tabler `table`. */
export const TablerTable = tabler(["M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14","M3 10h18","M10 3v18"])

/** Tabler `ban`. */
export const TablerBan = tabler(["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0","M5.7 5.7l12.6 12.6"])

/** Tabler `music`. */
export const TablerMusic = tabler(["M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0","M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0","M9 17v-13h10v13","M9 8h10"])

/** Tabler `zoom-in`. */
export const TablerZoomIn = tabler(["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0","M7 10l6 0","M10 7l0 6","M21 21l-6 -6"])

/** Tabler `zoom-out`. */
export const TablerZoomOut = tabler(["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0","M7 10l6 0","M21 21l-6 -6"])

/** Tabler `link`. */
export const TablerLink = tabler(["M9 15l6 -6","M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464","M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"])

/** Tabler `filter`. */
export const TablerFilter = tabler(["M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227"])

/** Tabler `movie`. */
export const TablerMovie = tabler(["M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12","M8 4l0 16","M16 4l0 16","M4 8l4 0","M4 16l4 0","M4 12l16 0","M16 8l4 0","M16 16l4 0"])

/** Tabler `mood-smile`. */
export const TablerMoodSmile = tabler(["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0","M9 10l.01 0","M15 10l.01 0","M9.5 15a3.5 3.5 0 0 0 5 0"])

/** Tabler `file-text`. */
export const TablerFileText = tabler(["M14 3v4a1 1 0 0 0 1 1h4","M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2","M9 9l1 0","M9 13l6 0","M9 17l6 0"])

/** Tabler `file`. */
export const TablerFile = tabler(["M14 3v4a1 1 0 0 0 1 1h4","M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2"])

/** Tabler `copy`. */
export const TablerCopy = tabler(["M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666","M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"])

/** Tabler `cloud-upload`. */
export const TablerCloudUpload = tabler(["M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1","M9 15l3 -3l3 3","M12 12l0 9"])

/** Tabler `message-dots`. */
export const TablerMessageDots = tabler(["M12 11v.01","M8 11v.01","M16 11v.01","M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3l12 0"])

/** Tabler `calendar`. */
export const TablerCalendar = tabler(["M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12","M16 3v4","M8 3v4","M4 11h16"])

/** Tabler `arrow-back-up`. */
export const TablerArrowBackUp = tabler(["M9 14l-4 -4l4 -4","M5 10h11a4 4 0 1 1 0 8h-1"])

/** Tabler `refresh`. */
export const TablerRefresh = tabler(["M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4","M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"])

/** Tabler `archive`. */
export const TablerArchive = tabler(["M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2","M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10","M10 12l4 0"])

/** Tabler `star`. */
export const TablerStar = tabler(["M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245"])

/** Tabler `messages`. */
export const TablerMessages = tabler(["M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10","M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2"])

/** Tabler `user`. */
export const TablerUser = tabler(["M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0","M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"])

/** Tabler `mail`. */
export const TablerMail = tabler(["M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10","M3 7l9 6l9 -6"])

/** Tabler `speakerphone`. */
export const TablerSpeakerphone = tabler(["M18 8a3 3 0 0 1 0 6","M10 8v11a1 1 0 0 1 -1 1h-1a1 1 0 0 1 -1 -1v-5","M12 8l4.524 -3.77a.9 .9 0 0 1 1.476 .692v12.156a.9 .9 0 0 1 -1.476 .692l-4.524 -3.77h-8a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h8"])

/** Tabler `shopping-bag`. */
export const TablerShoppingBag = tabler(["M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304","M9 11v-5a3 3 0 0 1 6 0v5"])

/** Tabler `sparkles`. */
export const TablerSparkles = tabler(["M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6"])

/** Tabler `user-plus`. */
export const TablerUserPlus = tabler(["M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0","M16 19h6","M19 16v6","M6 21v-2a4 4 0 0 1 4 -4h4"])

/** Tabler `arrow-down`. */
export const TablerArrowDown = tabler(["M12 5l0 14","M18 13l-6 6","M6 13l6 6"])
