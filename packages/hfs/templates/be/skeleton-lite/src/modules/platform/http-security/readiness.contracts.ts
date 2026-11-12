/** The required primary database and every required dependency the app registered answered before the readiness deadline. */
export interface ReadinessReport {
    /** Whether this process can serve requests requiring its dependencies. */
    readonly ok: true
}

/** One required dependency besides the primary database (the object store): it resolves once the dependency answers, else it rejects. */
export interface RequiredProbe {
    /** Answers the dependency, or rejects with why it cannot. */
    probe(): Promise<void>
}
