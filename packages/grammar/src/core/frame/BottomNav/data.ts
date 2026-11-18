import type { SidebarGroup, SidebarItem } from "../../composite/Sidebar/index.js"
import type { IconSource } from "../../leaf/Icon/index.js"
import type { NavigationBadgeTone } from "../../navigationBadgeTone.js"

/** At most this many places stand in the bar, the "more" place included (a thumb reaches five). */
export const BOTTOM_NAV_MAX_PLACES = 5

export type BottomNavItem = {
    readonly id: string
    /** The place's name, drawn under its glyph (one line). */
    readonly label: string
    readonly source: IconSource
    /** A count of work or news waiting there; `0` and an empty value draw nothing. */
    readonly badge?: number | string
    /** The count's words for a screen reader, e.g. "3 waiting for you". */
    readonly badgeLabel?: string
    readonly badgeMax?: number
    /** `neutral` (default) is information, the other tones are work waiting for the person; see `NavigationBadgeTone`. */
    readonly badgeTone?: NavigationBadgeTone
    /** A destination: the place is a real link through the app root's router. Without it the place is a command and `onAction` is its only effect. */
    readonly href?: string
}

/** The last place: it opens a bottom sheet of the places that did not fit in the bar. */
export type BottomNavMore = {
    /** The place's name in the bar and the title of the sheet ("More"). */
    readonly label: string
    readonly source: IconSource
    /** The sheet's close button name. */
    readonly closeLabel: string
    /** The rest of the places, listed flat in the sheet in their order. Give `items` or `groups`, not both. */
    readonly items?: ReadonlyArray<SidebarItem>
    /** The rest of the places under group headings (the `Sidebar` group: `id`, `label`, `items`), in their order; the sheet draws each group's `label` as its heading. */
    readonly groups?: ReadonlyArray<SidebarGroup>
    readonly badge?: number | string
    readonly badgeLabel?: string
    readonly badgeMax?: number
    readonly badgeTone?: NavigationBadgeTone
}
