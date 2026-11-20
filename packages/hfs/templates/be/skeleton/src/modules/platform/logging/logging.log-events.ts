/** Log events of the process lifecycle: the entry points log these. */
export enum LoggingLogEvent {
    /** The HTTP listener is bound and the service answers requests. */
    ServerStarted = "server.started",
    /** The service failed before it could serve; the process exits non-zero. */
    StartupFailed = "server.startup_failed",
    /** An ordinary Nest framework lifecycle message. */
    FrameworkLog = "platform.logging.framework.log",
    /** A Nest framework warning. */
    FrameworkWarning = "platform.logging.framework.warning",
    /** A Nest framework error. */
    FrameworkError = "platform.logging.framework.error",
    /** A Nest framework debug message. */
    FrameworkDebug = "platform.logging.framework.debug",
    /** A Nest framework verbose message. */
    FrameworkVerbose = "platform.logging.framework.verbose",
    /** A fatal Nest framework failure. */
    FrameworkFatal = "platform.logging.framework.fatal",
}
