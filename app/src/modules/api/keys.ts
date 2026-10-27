/** The cache key of every read; live events and writes invalidate by these. */
export const queryKeys = {
    overview: ["overview"] as const,
    workflow: (project: string, workflow: string) => ["workflow", project, workflow] as const,
    task: (project: string, task: string) => ["task", project, task] as const,
    inbox: ["inbox"] as const,
    config: ["config"] as const,
}
