/** The step the release verbs print once main moved on the harness (a train lands dev on main, then main comes back into dev): run only with --execute. */
export const BACK_MERGE_STEP = "then bring main back into dev, after the cli-follow commit when publish.yml makes one: starci release back-merge --execute (dry without it)"
