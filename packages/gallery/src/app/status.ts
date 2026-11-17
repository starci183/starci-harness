import type { Labels } from "../labels.ts"
import type { Status } from "../model.ts"

export type Tone = "success" | "warning" | "danger" | "accent" | "neutral" | "muted"

/** The dot of a status: matches green, built but differs amber, stale red, not built grey; a screen with no design has no dot colour of its own (muted). */
export const TONE: Readonly<Record<Status, Tone>> = { matches: "success", differs: "warning", stale: "danger", notBuilt: "neutral", drawn: "neutral", unrecorded: "accent", codedOnly: "accent", none: "muted" }

export const statusLabel = (labels: Labels, status: Status, designStatus: string | null = null): string =>
    status === "notBuilt" && designStatus === "drafted"
        ? labels.statusDrafted
        : status === "notBuilt" && designStatus === "approved"
          ? labels.statusApproved
          :     ({ matches: labels.statusMatches, differs: labels.statusDiffers, stale: labels.statusStale, notBuilt: labels.statusNotBuilt, drawn: labels.statusNotBuilt, unrecorded: labels.statusUnrecorded, codedOnly: labels.statusCodedOnly, none: labels.statusNone })[status]

/** The same tone for a bare status dot, which has no muted one: a screen with no design draws no dot at all, so this is only asked for the others. */
export const dotTone = (status: Status): "success" | "warning" | "danger" | "accent" | "neutral" => (TONE[status] === "muted" ? "neutral" : TONE[status])
