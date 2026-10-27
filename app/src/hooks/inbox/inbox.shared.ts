import type { Decision } from "@contract"

/** A decision's key across projects: its id is unique only inside its project. */
export const decisionKey = (decision: Pick<Decision, "project" | "id">): string => `${decision.project}/${decision.id}`

/** The decision on screen: the selected one while it is listed, else the first. */
export const selectedIndexOf = (decisions: readonly Decision[], selectedKey: string | null): number => {
    const index = decisions.findIndex((decision) => decisionKey(decision) === selectedKey)
    if (index !== -1) return index
    return decisions.length > 0 ? 0 : -1
}
