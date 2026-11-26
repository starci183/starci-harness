/** A credential the logging capability hands to its transport and never writes: it serializes as a mask. */
export interface LokiCredential {
    /** The plain `user:password` pair; called only where the transport is built. */
    reveal(): string
    /** The mask written when the options are serialized. */
    toJSON(): string
}

/** The stream labels every line pushed to Loki carries besides `stack` (the app), `level` and `event`: few, bounded values, never an id. */
export interface LokiLabels {
    /** The app (the stack name on a server). */
    readonly app: string
    /** The environment (`local`, `dev`, `staging`, `production`). */
    readonly env: string
    /** The service that writes the line: on a server the swarm service name (`<stack>_api`) the collector labels its lines with. */
    readonly service: string
}

/** Where and how the logger pushes its lines to Loki; absent, lines go to stdout and stderr only. */
export interface LokiOptions {
    /** The Loki base URL (`http://starci-monitor_loki:3100`); the transport appends `/loki/api/v1/push`. */
    readonly url: string
    /** Basic auth for a Loki behind a door; the shared stack's private network needs none. */
    readonly basicAuth?: LokiCredential
    /** The `X-Scope-OrgID` of a multi-tenant Loki. */
    readonly tenant?: string
    /** The stream labels. */
    readonly labels: LokiLabels
    /** Seconds between two pushes of the batch (default 5). */
    readonly batchSeconds?: number
    /** Milliseconds one push may take before it is abandoned (default 5000). */
    readonly timeoutMs?: number
    /** Lines held for Loki at most; past it new lines reach stdout and stderr only (default 10000). */
    readonly maxBuffered?: number
}

/** Options of the logging capability. */
export interface LoggingOptions {
    /** The stream info lines go to: "stdout" (default) for servers, "stderr" for a CLI whose stdout carries only command output. Warn and error always go to stderr. */
    readonly info?: "stdout" | "stderr"
    /** Push every line to Loki as well (`winston-loki`), when the environment declares LOKI_URL. */
    readonly loki?: LokiOptions
}
