/**
 * The PromQL and LogQL the monitor bot sends, built from an app's scope: the swarm stacks of its environments on this server. Every app
 * query carries a stack matcher of the scope, so an app's bot never reads another app's series; the host queries read node-exporter, the
 * machine's own series. A stack name is checked against the swarm stack shape before it is quoted into a matcher.
 */

/** A swarm stack name as `docker stack deploy` takes it. */
export const STACK_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/

/** The scope of one app bot: its project and the stacks of its environments on this server. */
export interface Scope {
    readonly project: string
    readonly stacks: readonly string[]
}

/** Escapes a value for a double-quoted PromQL or LogQL string. */
export const quote = (value: string): string => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

/** Escapes a literal for a RE2 regex. */
const reEscape = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The stack matcher of a scope (`stack=~"a|b"`); refused when the scope holds no stack or a malformed one. */
export const stackMatcher = (scope: Scope, label = "stack"): string => {
    if (scope.stacks.length === 0) throw new Error(`the scope of ${scope.project} holds no stack`)
    for (const stack of scope.stacks) if (!STACK_NAME.test(stack)) throw new Error(`${stack} is no swarm stack name`)
    return `${label}=~${quote(scope.stacks.map(reEscape).join("|"))}`
}

/** The root filesystem node-exporter reads (it mounts / at /rootfs) and the file systems no disk view counts. */
const ROOT_FS = 'fstype!~"tmpfs|overlay|squashfs|nsfs"'

/** The PromQL of the host summary every app may read: the machine's CPU, memory and root disk use as fractions. */
export const hostQueries = {
    cpu: '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))',
    memoryUsed: "sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)",
    memoryTotal: "sum(node_memory_MemTotal_bytes)",
    memory: "1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)",
    disk: `1 - sum(node_filesystem_avail_bytes{mountpoint="/rootfs",${ROOT_FS}}) / sum(node_filesystem_size_bytes{mountpoint="/rootfs",${ROOT_FS}})`,
    diskSize: `node_filesystem_size_bytes{${ROOT_FS}}`,
    diskAvail: `node_filesystem_avail_bytes{${ROOT_FS}}`,
    diskAvail7dAgo: `node_filesystem_avail_bytes{${ROOT_FS}} offset 7d`,
    diskAvail1dAgo: `sum(node_filesystem_avail_bytes{mountpoint="/rootfs",${ROOT_FS}} offset 1d)`,
    diskAvailRoot: `sum(node_filesystem_avail_bytes{mountpoint="/rootfs",${ROOT_FS}})`,
    uptime: "min(time() - node_boot_time_seconds)",
} as const

/** The CPU use (in cores) of the scope's services, the top `limit`. */
export const topCpu = (scope: Scope, limit = 5): string => `topk(${String(limit)}, sum by (service) (rate(container_cpu_usage_seconds_total{${stackMatcher(scope)}}[5m])))`

/** The working memory of the scope's services, the top `limit`. */
export const topMemory = (scope: Scope, limit = 5): string => `topk(${String(limit)}, sum by (service) (container_memory_working_set_bytes{${stackMatcher(scope)}}))`

/** The services of the scope as cAdvisor sees them: their start time (uptime), their restarts over 24h, their working memory. */
export const serviceQueries = (scope: Scope): { readonly started: string; readonly restarts: string; readonly dbConnections: string; readonly memory: string } => ({
    started: `max by (service) (container_start_time_seconds{${stackMatcher(scope)}})`,
    restarts: `sum by (service) (changes(container_start_time_seconds{${stackMatcher(scope)}}[24h]))`,
    dbConnections: `sum by (service) (pg_stat_activity_count{${stackMatcher(scope)}})`,
    memory: `sum by (service) (container_memory_working_set_bytes{${stackMatcher(scope)}})`,
})

/**
 * The edge's view of the scope: the edge Traefik names a swarm service's router after it, so its services are matched by the stack prefix.
 * The 5xx share and the p95 latency over `window` (a PromQL duration).
 */
export const edgeQueries = (scope: Scope, window: string): { readonly errorRate: string; readonly p95: string; readonly requests: string } => {
    const services = stackMatcher(scope, "service").replace(/=~"(.*)"$/, (_whole, alternatives: string) => `=~"(${alternatives}).*"`)
    return {
        errorRate: `sum(rate(traefik_service_requests_total{${services},code=~"5.."}[${window}])) / sum(rate(traefik_service_requests_total{${services}}[${window}]))`,
        p95: `histogram_quantile(0.95, sum by (le) (rate(traefik_service_request_duration_seconds_bucket{${services}}[${window}])))`,
        requests: `sum(increase(traefik_service_requests_total{${services}}[${window}]))`,
    }
}

/** How often the scope's alerts fired over `window`, by name (Prometheus keeps ALERTS as a series); host alerts carry no stack. */
export const alertHistory = (scope: Scope, window: string): string => `count by (alertname) (count_over_time(ALERTS{alertstate="firing",${stackMatcher(scope)}}[${window}]))`

/** The share of the scope's scraped targets up over `window`. */
export const uptimeShare = (scope: Scope, window: string): string => `avg(avg_over_time(up{${stackMatcher(scope)}}[${window}]))`

/** The step of a range query of `seconds`: about 48 points, never under 30 seconds (the scrape interval). */
export const stepOf = (seconds: number): number => Math.max(30, Math.ceil(seconds / 48 / 30) * 30)

/** The PromQL a chart of a metric draws for the scope (the host metrics are the machine's, 5xx the scope's). */
export const chartQuery = (metric: "cpu" | "ram" | "disk" | "5xx", scope: Scope): string => {
    switch (metric) {
        case "cpu":
            return hostQueries.cpu
        case "ram":
            return hostQueries.memory
        case "disk":
            return hostQueries.disk
        case "5xx":
            return edgeQueries(scope, "5m").errorRate
    }
}

/** The swarm services a short or full name may be in the scope: `api` is `<stack>_api` of each stack, a full name must be in one. */
export const servicesOf = (scope: Scope, name: string): string[] => {
    const full = scope.stacks.filter((stack) => name.startsWith(`${stack}_`))
    return full.length > 0 ? [name] : scope.stacks.map((stack) => `${stack}_${name}`)
}

/** The LogQL of /logs: the errors and warnings of one service of the scope, newest first (the caller asks for 15 lines). */
export const logsQuery = (scope: Scope, name: string): string => {
    const services = servicesOf(scope, name)
    return `{${stackMatcher(scope)}, service=~${quote(services.map(reEscape).join("|"))}} |~ "(?i)(error|warn|fatal|panic|exception)"`
}

/** The Grafana Explore link of a LogQL query over the last `seconds`, or null without a Grafana door. */
export const exploreLink = (grafana: string | null, expr: string, seconds: number): string | null => {
    if (grafana === null) return null
    const left = { datasource: "loki", queries: [{ refId: "A", expr }], range: { from: `now-${String(Math.round(seconds / 60))}m`, to: "now" } }
    return `${grafana.replace(/\/$/, "")}/explore?orgId=1&left=${encodeURIComponent(JSON.stringify(left))}`
}
