// Writes the gateway settings the StarCi runtime layer relies on into openclaw.json before the gateway starts (idempotent merge: other keys,
// agents and plugins that OpenClaw or an operator added are kept). Loopback bind + token auth: the gateway is reached only through the relay.
//
// The contract an app image relies on (images/README.md "The OpenClaw runtime layer"):
//   STARCI_PLUGINS_DIR   the plugin directory (default /opt/starci/plugins): every subfolder holding an openclaw.plugin.json is added to
//                        plugins.load.paths and enabled as plugins.entries.<folder name>
//   AI_BASE_URL + STARCI_AI_KEY  one OpenAI-compatible custom provider (name OPENCLAW_PROVIDER, default "starci-ai"; chat model AI_CHAT_MODEL,
//                        default "work"); the key stays a reference openclaw resolves from the gateway process environment
//   OPENCLAW_MODEL       the primary model of the agents; OPENCLAW_MODEL_REASONING=off switches the model's reasoning off
import fs from "node:fs"
import path from "node:path"

const file = "/home/node/.openclaw/openclaw.json"
let config = {}
try {
    config = JSON.parse(fs.readFileSync(file, "utf8"))
} catch {
    config = {}
}
// The app writes each agent workspace itself: no first-run ritual.
config.agents = config.agents || {}
config.agents.defaults = { ...(config.agents.defaults || {}), skipBootstrap: true }
// The app owns every trigger and schedule: OpenClaw runs one turn when asked and nothing in the background. `cron.enabled: false` stops its cron
// scheduler; a `defaults.heartbeat` block makes every agent resolve its heartbeat from it, and `every: "0m"` gives each no interval.
config.cron = { ...(config.cron || {}), enabled: false }
config.agents.defaults.heartbeat = { ...(config.agents.defaults.heartbeat || {}), every: "0m" }
// Plugins: every folder of the plugin directory that holds an openclaw.plugin.json is loaded and enabled; other paths and entries are kept.
const pluginsDir = process.env.STARCI_PLUGINS_DIR || "/opt/starci/plugins"
const found = fs.existsSync(pluginsDir)
    ? fs.readdirSync(pluginsDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(pluginsDir, entry.name, "openclaw.plugin.json")))
          .map((entry) => entry.name)
          .sort()
    : []
const plugins = config.plugins || {}
const load = plugins.load || {}
const paths = Array.isArray(load.paths) ? load.paths : []
const entries = { ...(plugins.entries || {}) }
for (const name of found) entries[name] = { ...(entries[name] || {}), enabled: true }
config.plugins = {
    ...plugins,
    load: { ...load, paths: [...paths, ...found.map((name) => path.join(pluginsDir, name)).filter((folder) => !paths.includes(folder))] },
    entries,
}
config.session = {
    ...(config.session || {}),
    maintenance: {
        ...((config.session || {}).maintenance || {}),
        mode: "enforce",
        pruneAfter: "7d",
        maxEntries: 400,
        maxDiskBytes: "400mb",
    },
}
config.gateway = {
    ...(config.gateway || {}),
    mode: "local",
    bind: "loopback",
    port: 18789,
    auth: {
        ...((config.gateway || {}).auth || {}),
        mode: "token",
        token: fs.readFileSync(process.env.OPENCLAW_GATEWAY_TOKEN_FILE, "utf8"),
    },
}
// Language models come only from the AI gateway the app hosts: one OpenAI-compatible custom provider with the virtual key it shares with the app.
if (process.env.AI_BASE_URL && process.env.STARCI_AI_KEY) {
    const chat = process.env.AI_CHAT_MODEL || "work"
    const provider = process.env.OPENCLAW_PROVIDER || "starci-ai"
    config.models = {
        ...(config.models || {}),
        mode: "merge",
        providers: {
            ...((config.models || {}).providers || {}),
            [provider]: {
                baseUrl: process.env.AI_BASE_URL,
                apiKey: "${STARCI_AI_KEY}",
                api: "openai-completions",
                models: [{ id: chat, name: chat, input: ["text", "image"] }],
            },
        },
    }
}
const model = process.env.OPENCLAW_MODEL
if (model) {
    config.agents.defaults.model = { ...(config.agents.defaults.model || {}), primary: model }
    if (process.env.OPENCLAW_MODEL_REASONING === "off") {
        const models = (config.agents.defaults.models = config.agents.defaults.models || {})
        const previous = models[model] || {}
        models[model] = {
            ...previous,
            params: {
                ...(previous.params || {}),
                extra_body: { ...((previous.params || {}).extra_body || {}), reasoning: { enabled: false } },
            },
        }
    }
}
fs.mkdirSync("/home/node/.openclaw", { recursive: true })
fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 })
console.log("openclaw.json ready (gateway local/loopback/token, " + found.length + " plugin" + (found.length === 1 ? "" : "s") + (model ? ", model " + model : "") + ")")
