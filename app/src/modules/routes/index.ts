/**
 * Every path of the app, built here. The router is a hash router (the desktop shell serves one file), so these are the
 * parts after `#`; `?fixtures=1` and `?token=` stay in the page's own query.
 */
export const APP_ROUTES = {
    overview: "/",
    inbox: "/inbox",
    settings: "/settings",
    workflow: "/w/:project/:workflow",
    task: "/t/:project/:task",
} as const

/** One workflow's screen. */
export const workflowPath = (project: string, workflow: string): string =>
    `/w/${encodeURIComponent(project)}/${encodeURIComponent(workflow)}`

/** One task's screen. */
export const taskPath = (project: string, task: string): string => `/t/${encodeURIComponent(project)}/${encodeURIComponent(task)}`
