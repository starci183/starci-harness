/**
 * The tone of the count a navigation item carries (a `Sidebar` item, a `BottomNav` item): `neutral` (default) is a fact to
 * know, the others are work for the reader or an outcome. A tone on its tint reads `x-soft` with `x-soft-foreground` (neutral
 * reads `default` with `default-foreground`), the pairs a `Badge` of the same tone uses. The count is always printed, so the tone
 * is never the only signal.
 */
export type NavigationBadgeTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"
