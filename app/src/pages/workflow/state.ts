import type { Member } from "@contract"
import { COMMON } from "../../app/labels"

/** `agent · model · effort`, the way a member is named everywhere on these screens. */
export const memberText = (member: Member): string =>
    [member.agent, member.model, member.effort === null ? null : COMMON.effort(member.effort)].filter((part) => part !== null).join(" · ")

/** Elapsed time since an instant, as a short `6m` / `1h 4m` / `12s`. */
export const elapsedText = (since: string, now: number = Date.now()): string => {
    const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
    if (Number.isNaN(seconds)) return ""
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export const workflowPath = (project: string, workflow: string): string => `/w/${encodeURIComponent(project)}/${encodeURIComponent(workflow)}`
export const taskPath = (project: string, task: string): string => `/t/${encodeURIComponent(project)}/${encodeURIComponent(task)}`
