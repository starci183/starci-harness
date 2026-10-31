/**
 * The rules that hold model calls behind the ai-router gateway (catalog R326 `BE_AI_KEY_CUSTODY`, R327
 * `BE_AI_GATEWAY_CLIENT`, R344 `BE_AI_VIRTUAL_KEY`; contexts/code/be/ai.md BE-AI-1 and BE-AI-3).
 *
 *   - `provider-key-custody` keeps every upstream provider key inside the gateway's custody owner, `integrations/ai-gateway`,
 *     the one owner that registers `@starci/ai-router` with the provider pool. Anywhere else a provider key variable
 *     (`PROVIDER_KEY_VARIABLES` below, the one list) is refused in any spelling a read can take: a string literal or a
 *     template without substitutions naming it or its `<NAME>_FILE` custody twin, and a non-computed member or property
 *     named like it (`process.env.OPENAI_API_KEY`, `{ OPENROUTER_API_KEY } = env`, `{ OPENAI_API_KEY: value }`). Specs and the
 *     test world are judged too: they reach a model through the gateway's fake provider, never with a provider key.
 *   - `ai-client-through-gateway` judges every `new` of an export of `@langchain/openai`, the one LangChain provider package:
 *     only `ChatOpenAI` and `OpenAIEmbeddings` are built, each from an inline options object with no spread, whose
 *     `configuration.baseURL` is a member read off an options type declared in a `<c>.options.ts` (the gateway URL the
 *     integration's config parsed), and whose `apiKey` is the `reveal()` of a `Secret` of `platform/config` (the gateway's
 *     virtual key). A literal provider URL, a missing base URL (the library falls back to the provider's own) and a
 *     missing key (the library falls back to `OPENAI_API_KEY`) are refused. The constructor is found by its import, never
 *     by its spelling.
 *   - `ai-virtual-key-name` holds the one client key of the gateway: inside `integrations/ai` every `<env>.secret(...)` names
 *     exactly `STARCI_AI_KEY` (`VIRTUAL_KEY_VARIABLE`) as a literal, the virtual key the gateway mounts from the sealed `ai`
 *     member; and the custody owner hands the gateway no `adminToken`, since the gateway exposes no admin API.
 *
 * Which owner may import LangChain, `openai` or another provider SDK at all is the infrastructure table of the slot
 * manifest (`ruleParams.be.infraOwners`, judged by `infra-import-owner`, R90).
 */
import { keyName, staticText } from "./lib/ast.ts"
import { originsOf } from "./lib/declared.ts"
import { hfsOf } from "./lib/hfs.ts"
import { importOf } from "./lib/import-source.ts"
import { isOwnedType } from "./lib/ports.ts"
import type { TSESTree } from "@typescript-eslint/utils"
import type { Context, Node, Recommended, RuleModule, Rules } from "./lib/rule.ts"

/** The owner id (`<tier>/<capability>`) that holds the provider keys and registers the gateway's pool. */
export const GATEWAY_CUSTODY = "integrations/ai-gateway"

/**
 * The upstream provider key variables, the one list: a key that reaches any of these providers is read only by the
 * gateway's custody owner. A provider the gateway adds joins this list.
 */
export const PROVIDER_KEY_VARIABLES: readonly string[] = Object.freeze([
    "OPENROUTER_API_KEY",
    "OPENROUTER_KEY",
    "OPENAI_API_KEY",
    "OPENAI_KEY",
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "MISTRAL_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "TOGETHER_API_KEY",
    "FIREWORKS_API_KEY",
    "COHERE_API_KEY",
    "XAI_API_KEY",
    "PERPLEXITY_API_KEY",
    "HUGGINGFACEHUB_API_KEY",
    "HF_TOKEN",
])

const PROVIDER_KEYS = new Set(PROVIDER_KEY_VARIABLES.flatMap((name) => [name, `${name}_FILE`]))

/** The one virtual key every client of the gateway authenticates with (`sk-starci-<app>-<48 hex>`, sealed in the `ai` member). */
export const VIRTUAL_KEY_VARIABLE = "STARCI_AI_KEY"

/** The owner id of the app's LangChain integration, whose config reads the virtual key. */
const AI_INTEGRATION = "integrations/ai"

/** The LangChain provider package whose clients are judged, and the clients code may build from it. */
const LANGCHAIN_OPENAI = "@langchain/openai"
const GATEWAY_CLIENTS = new Set(["ChatOpenAI", "OpenAIEmbeddings"])

/** The owner id of a file: the last two segments of its owner root, or null when no owner holds it. */
const ownerIdOf = (context: Context, filename: string): string | null => {
    const root = hfsOf(context).ownerOf(filename)
    return root === null ? null : root.split("/").slice(-2).join("/")
}

/** Only the gateway's custody owner names an upstream provider key. */
export const providerKeyCustody: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "An upstream provider key variable (OPENROUTER_API_KEY, OPENAI_API_KEY, ...) is read only by the gateway's custody owner `integrations/ai-gateway`." },
        schema: [],
        messages: {
            custody: "`{{name}}` is an upstream provider key, held only by the ai-router gateway's custody owner `integrations/ai-gateway`. Call a model through the gateway: the `integrations/ai` LangChain client with its virtual key (`sk-starci-...`), or the agent runtime's own virtual key.",
        },
    },
    create(context) {
        if (ownerIdOf(context, context.filename) === GATEWAY_CUSTODY) return {}
        const judge = (node: Node, name: string | null) => {
            if (name !== null && PROVIDER_KEYS.has(name)) context.report({ node, messageId: "custody", data: { name } })
        }
        return {
            Literal(node) {
                judge(node, staticText(node))
            },
            TemplateLiteral(node) {
                judge(node, staticText(node))
            },
            MemberExpression(node) {
                if (!node.computed) judge(node.property, keyName(node.property))
            },
            Property(node) {
                if (!node.computed && node.key.type === "Identifier") judge(node.key, node.key.name)
            },
        }
    },
}

/** The `@langchain/openai` export a constructor callee names, or null when it names none. */
const langchainExportOf = (context: Context, callee: Node): string | null => {
    const fromPackage = (source: string) => source === LANGCHAIN_OPENAI || source.startsWith(`${LANGCHAIN_OPENAI}/`)
    if (callee.type === "Identifier") {
        const binding = importOf(context, callee)
        return binding !== null && fromPackage(binding.source) ? (binding.imported ?? "default") : null
    }
    if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier") {
        const binding = importOf(context, callee.object)
        return binding?.imported === "*" && fromPackage(binding.source) ? keyName(callee.property) : null
    }
    return null
}

/** The value of a plain (non-computed, non-spread) property of an object literal, or null. */
const propertyOf = (object: TSESTree.ObjectExpression, name: string): Node | null => {
    for (const property of object.properties) {
        if (property.type === "Property" && !property.computed && keyName(property.key) === name) return property.value
    }
    return null
}

/** True when the object literal, or any object literal nested in it, spreads another value in. */
const spreads = (object: TSESTree.ObjectExpression): boolean =>
    object.properties.some((property) => property.type === "SpreadElement" || (property.value.type === "ObjectExpression" && spreads(property.value)))

/** A member read off a value whose type a `<c>.options.ts` of the repository declares: the URL the integration's config parsed. */
const isOptionsMember = (context: Context, node: Node): boolean => {
    if (node.type !== "MemberExpression" || node.computed) return false
    const hfs = hfsOf(context)
    return originsOf(context, node.object).some((origin) => origin.file.endsWith(".options.ts") && hfs.slotOf(origin.file) !== null)
}

/** `secret.reveal()` on a `Secret` of `platform/config`: the virtual key handed to the library that needs it. */
const isRevealedSecret = (context: Context, node: Node): boolean =>
    node.type === "CallExpression" &&
    node.arguments.length === 0 &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    keyName(node.callee.property) === "reveal" &&
    isOwnedType(context, node.callee.object, { name: "Secret", capability: "config", tier: "platform" })

/** The LangChain clients point at the gateway: base URL from options, virtual key from a `Secret`. */
export const aiClientThroughGateway: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "Only `ChatOpenAI` and `OpenAIEmbeddings` of `@langchain/openai` are built, each with `configuration.baseURL` read from the integration's options and `apiKey` revealed from a `Secret`." },
        schema: [],
        messages: {
            client: "`{{name}}` of `@langchain/openai` is not a gateway client. Build `ChatOpenAI` for chat and `OpenAIEmbeddings` for vectors, both pointed at the ai-router gateway; another provider is a pool entry of the gateway, never a client here.",
            inline: "`{{name}}` takes an inline options object with no spread, so its base URL and key are visible here: `new {{name}}({ model, apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: this.options.gatewayUrl } })`.",
            baseUrl: "`{{name}}` needs `configuration.baseURL` read from the integration's options (`this.options.gatewayUrl`, parsed by its `<c>.config.ts`). A missing base URL calls the provider directly and a literal URL hard-codes one: every model call goes through the ai-router gateway.",
            apiKey: "`{{name}}` needs `apiKey` set to the gateway's virtual key as `<secret>.reveal()` of a `Secret` from `platform/config` (`this.options.virtualKey.reveal()`). Without it the library reads `OPENAI_API_KEY` from the environment.",
        },
    },
    create(context) {
        return {
            NewExpression(node) {
                const name = langchainExportOf(context, node.callee)
                if (name === null) return
                if (!GATEWAY_CLIENTS.has(name)) {
                    context.report({ node, messageId: "client", data: { name } })
                    return
                }
                const options = node.arguments[0]
                if (node.arguments.length !== 1 || options?.type !== "ObjectExpression" || spreads(options)) {
                    context.report({ node, messageId: "inline", data: { name } })
                    return
                }
                const configuration = propertyOf(options, "configuration")
                const baseUrl = configuration?.type === "ObjectExpression" ? propertyOf(configuration, "baseURL") : null
                if (baseUrl === null || !isOptionsMember(context, baseUrl)) context.report({ node: baseUrl ?? node, messageId: "baseUrl", data: { name } })
                const apiKey = propertyOf(options, "apiKey")
                if (apiKey === null || !isRevealedSecret(context, apiKey)) context.report({ node: apiKey ?? node, messageId: "apiKey", data: { name } })
            },
        }
    },
}

/** `<x>.secret(<arg>)`: the first argument of a non-computed `secret` member call, or null. */
const secretArgumentOf = (node: TSESTree.CallExpression): Node | null =>
    node.callee.type === "MemberExpression" && !node.callee.computed && keyName(node.callee.property) === "secret" ? (node.arguments[0] ?? null) : null

/** The gateway's one client key is `STARCI_AI_KEY`, read by `integrations/ai`; the gateway gets no admin token. */
export const aiVirtualKeyName: RuleModule = {
    meta: {
        type: "problem",
        docs: { description: "`integrations/ai` reads exactly `STARCI_AI_KEY` as its secret, and the gateway's custody owner passes no admin token." },
        schema: [],
        messages: {
            name: "`integrations/ai` reads one secret, the gateway's virtual key `STARCI_AI_KEY` (`env.secret(\"STARCI_AI_KEY\")`); `{{name}}` is not it. Every client of the gateway, this integration and the agent runtime alike, uses that one key.",
            dynamic: "`integrations/ai` names its secret as the literal `\"STARCI_AI_KEY\"`, so the one virtual key the gateway mounts is visible here.",
            adminToken: "The ai-router gateway exposes no admin API: pass no `adminToken`. The one virtual key `STARCI_AI_KEY` is mounted from the sealed `ai` member (`mountedKeys`) and rotated by resealing it and deploying.",
        },
    },
    create(context) {
        const owner = ownerIdOf(context, context.filename)
        return {
            Property(node) {
                if (node.computed || node.key.type !== "Identifier") return
                if (owner === GATEWAY_CUSTODY && node.key.name === "adminToken") context.report({ node: node.key, messageId: "adminToken" })
            },
            CallExpression(node) {
                if (owner !== AI_INTEGRATION) return
                const argument = secretArgumentOf(node)
                if (argument === null) return
                const name = staticText(argument)
                if (name === null) context.report({ node: argument, messageId: "dynamic" })
                else if (name !== VIRTUAL_KEY_VARIABLE) context.report({ node: argument, messageId: "name", data: { name } })
            },
        }
    },
}

/** The rules this law contributes to the plugin. */
export const rules = {
    "provider-key-custody": providerKeyCustody,
    "ai-client-through-gateway": aiClientThroughGateway,
    "ai-virtual-key-name": aiVirtualKeyName,
} satisfies Rules

/** Every rule of this law at `error`. */
export const recommended: Recommended = {
    "starci-be/provider-key-custody": "error",
    "starci-be/ai-client-through-gateway": "error",
    "starci-be/ai-virtual-key-name": "error",
}
