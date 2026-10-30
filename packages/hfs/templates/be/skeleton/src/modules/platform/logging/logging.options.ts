/** Options of the logging capability. */
export interface LoggingOptions {
    /** The stream info lines go to: "stdout" (default) for servers, "stderr" for a CLI whose stdout carries only command output. Warn and error always go to stderr. */
    readonly info?: "stdout" | "stderr"
}
