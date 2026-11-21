/**
 * The commands of the monitor bot and their parsing (PROJECT-MONITORING-6). A command is `/name` (or `/name@thisbot` in a group) and its
 * arguments; each argument is checked here against a closed shape, so nothing a chat types reaches a PromQL, LogQL or API call unchecked.
 */

/** Every command the bot answers; `write` marks the ones only an admin may run. */
export const COMMANDS = {
    status: { write: false, usage: "/status", summary: "sức khỏe tổng quát: môi trường, phiên bản, uptime, p95, 5xx, CPU/RAM/disk của máy" },
    cpu: { write: false, usage: "/cpu [1h|6h|24h]", summary: "CPU của máy: thanh, sparkline, các service tốn CPU nhất" },
    ram: { write: false, usage: "/ram [1h|6h|24h]", summary: "RAM của máy: đã dùng/tổng, ngưỡng cảnh báo, các service tốn RAM nhất" },
    disk: { write: false, usage: "/disk", summary: "từng phân vùng, mức tăng 7 ngày và ước tính ngày đầy" },
    svc: { write: false, usage: "/svc", summary: "từng service: replicas, uptime, số lần khởi động lại, kết nối DB" },
    logs: { write: false, usage: "/logs <service> [15m|1h|6h]", summary: "lỗi và cảnh báo mới nhất từ Loki (tối đa 15 dòng) kèm link Grafana" },
    alerts: { write: false, usage: "/alerts", summary: "cảnh báo đang mở, đang im lặng và 24 giờ qua" },
    silence: { write: true, usage: "/silence <tên|all> <30m|1h|...|7d>", summary: "im lặng cảnh báo qua Alertmanager (chỉ admin, có xác nhận)" },
    deploys: { write: false, usage: "/deploys", summary: "các lần cập nhật service gần nhất của từng môi trường" },
    chart: { write: false, usage: "/chart <cpu|ram|disk|5xx> [1h|6h|24h|7d]", summary: "biểu đồ của chỉ số trong khoảng thời gian" },
    help: { write: false, usage: "/help", summary: "danh sách lệnh" },
} as const

/** A command name. */
export type CommandName = keyof typeof COMMANDS

/** A parsed command, its arguments checked. */
export type Command =
    | { readonly name: "status" | "disk" | "svc" | "alerts" | "deploys" | "help" }
    | { readonly name: "cpu" | "ram"; readonly range: Range }
    | { readonly name: "logs"; readonly service: string; readonly range: Range }
    | { readonly name: "silence"; readonly target: string; readonly seconds: number }
    | { readonly name: "chart"; readonly metric: ChartMetric; readonly range: Range }

/** A parse that did not yield a command: not a command at all (ignored), or a command used wrongly (answered with its usage). */
export type ParseResult = { readonly kind: "command"; readonly command: Command } | { readonly kind: "ignore" } | { readonly kind: "usage"; readonly text: string }

/** A time range a chat may ask for, and its length in seconds. */
export const RANGES = { "15m": 900, "30m": 1800, "1h": 3600, "6h": 21_600, "24h": 86_400, "7d": 604_800 } as const

/** A range name. */
export type Range = keyof typeof RANGES

/** The metrics /chart draws. */
export const CHART_METRICS = ["cpu", "ram", "disk", "5xx"] as const

/** A chart metric. */
export type ChartMetric = (typeof CHART_METRICS)[number]

/** The longest silence a chat may set: 7 days. */
export const MAX_SILENCE_SECONDS = 604_800

const DURATION = /^(\d{1,4})(m|h|d)$/

/** A duration like `30m`, `2h`, `1d`, in seconds, or null; at most 7 days, at least one minute. */
export const parseDuration = (text: string): number | null => {
    const match = DURATION.exec(text)
    if (match === null) return null
    const seconds = Number(match[1]) * ({ m: 60, h: 3600, d: 86_400 } as const)[match[2] as "m" | "h" | "d"]
    return seconds >= 60 && seconds <= MAX_SILENCE_SECONDS ? seconds : null
}

/** An alert name as Prometheus writes one, or `all`. */
export const ALERT_NAME = /^(?:all|[A-Za-z_][A-Za-z0-9_]{0,99})$/

/** A service name a chat may type: a swarm service or its short name in the stack. */
export const SERVICE_NAME = /^[a-z0-9][a-z0-9_.-]{0,99}$/

const isCommand = (name: string): name is CommandName => Object.hasOwn(COMMANDS, name)

const rangeOf = (text: string | undefined, allowed: readonly Range[], fallback: Range): Range | null => {
    if (text === undefined) return fallback
    return (allowed as readonly string[]).includes(text) ? (text as Range) : null
}

/**
 * Parses a message's text. `bot` is this bot's username: `/cpu@otherbot` in a group is another bot's and ignored. Text that is no command,
 * or names no command of this bot, is ignored (a chat may hold other talk).
 */
export const parseCommand = (text: string, bot: string): ParseResult => {
    const words = text.trim().split(/\s+/)
    const head = words[0] ?? ""
    const match = /^\/([a-z]+)(?:@([A-Za-z0-9_]+))?$/i.exec(head)
    if (match === null) return { kind: "ignore" }
    const [, rawName = "", mention] = match
    if (mention !== undefined && mention.toLowerCase() !== bot.toLowerCase()) return { kind: "ignore" }
    const name = rawName.toLowerCase()
    if (name === "start") return { kind: "command", command: { name: "help" } }
    if (!isCommand(name)) return { kind: "ignore" }
    const args = words.slice(1)
    const usage: ParseResult = { kind: "usage", text: `Cú pháp: ${COMMANDS[name].usage}` }
    switch (name) {
        case "status":
        case "disk":
        case "svc":
        case "alerts":
        case "deploys":
        case "help":
            return args.length === 0 ? { kind: "command", command: { name } } : usage
        case "cpu":
        case "ram": {
            const range = args.length <= 1 ? rangeOf(args[0], ["1h", "6h", "24h"], "1h") : null
            return range === null ? usage : { kind: "command", command: { name, range } }
        }
        case "logs": {
            const service = args[0]
            const range = args.length <= 2 ? rangeOf(args[1], ["15m", "1h", "6h"], "15m") : null
            return service === undefined || !SERVICE_NAME.test(service) || range === null ? usage : { kind: "command", command: { name, service, range } }
        }
        case "silence": {
            const [target, duration] = args
            const seconds = duration === undefined ? null : parseDuration(duration)
            return args.length !== 2 || target === undefined || !ALERT_NAME.test(target) || seconds === null ? usage : { kind: "command", command: { name, target, seconds } }
        }
        case "chart": {
            const metric = args[0]
            const range = args.length <= 2 ? rangeOf(args[1], ["1h", "6h", "24h", "7d"], "24h") : null
            return metric === undefined || !(CHART_METRICS as readonly string[]).includes(metric) || range === null ? usage : { kind: "command", command: { name, metric: metric as ChartMetric, range } }
        }
    }
}

/** The text a command is written back as (a button's callback carries it, and it is parsed again when pressed). */
export const commandText = (command: Command): string => {
    switch (command.name) {
        case "cpu":
        case "ram":
            return `/${command.name} ${command.range}`
        case "logs":
            return `/logs ${command.service} ${command.range}`
        case "silence":
            return `/silence ${command.target} ${String(Math.round(command.seconds / 60))}m`
        case "chart":
            return `/chart ${command.metric} ${command.range}`
        case "status":
        case "disk":
        case "svc":
        case "alerts":
        case "deploys":
        case "help":
            return `/${command.name}`
    }
}

/** The /help reply. */
export const helpText = (): string =>
    ["<b>Lệnh giám sát</b>", ...Object.values(COMMANDS).map((command) => `<code>${command.usage.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</code> — ${command.summary}`)].join("\n")
