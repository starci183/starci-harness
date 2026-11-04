/**
 * The components of the Grammar that do NOT draw a loading state from the region around them, each with its reason. Every other
 * component of `core/leaf`, `core/branch` and `core/composite` honours the region (`withRegionLoading`, `withRegionInert`,
 * `withRegionGeometry`, `useIsLoading` or a `FieldSkeletonScope`); `scripts/check-region-loading.mts` fails when a component is
 * neither, so a new component cannot ship without an answer (law `DNA-COMMON-LOADING-REGION-INERT`).
 */
export const REGION_LOADING_EXEMPT: Readonly<Record<string, string>> = {
    "leaf/CalendarDay": "a cell the Calendar draws; the Calendar carries the loading state",
    "leaf/Code": "static copy: real text stays real",
    "leaf/Divider": "a line, no data",
    "leaf/Heading": "static chrome: a heading stays real text",
    "leaf/Icon": "a glyph, no data",
    "leaf/IconTile": "a decorative mark; geometry only when its owner says so",
    "leaf/Kbd": "a key name, static",
    "leaf/Label": "static chrome: a field label stays real text",
    "leaf/Mascot": "decorative art",
    "leaf/Skeleton": "is the loading geometry",
    "leaf/Spinner": "is a pending cue, never a skeleton",
    "leaf/Text": "static chrome: copy stays real text",
    "branch/DragItem": "a drag frame around content the app draws",
    "branch/DropdownMenu": "its entries are an overlay, a fresh region",
    "branch/Tooltip": "an overlay, a fresh region",
    "composite/EmptyNotice": "an answer that is never drawn while a region loads",
    "composite/Footer": "app chrome",
    "composite/Sidebar": "app chrome",
    "composite/Toast": "a transient overlay",
    "composite/TopBar": "app chrome",
}
