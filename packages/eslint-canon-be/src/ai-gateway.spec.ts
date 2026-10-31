/**
 * Twin tests for the model-gateway law (R326 `BE_AI_KEY_CUSTODY`, R327 `BE_AI_GATEWAY_CLIENT`, R344 `BE_AI_VIRTUAL_KEY`) and the model SDK rows of
 * the infrastructure table it leans on (R90 `BE_INFRA_OWNER`).
 *
 *   node --test src/ai-gateway.spec.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import tsParser from "@typescript-eslint/parser"
import { canonRuleTester } from "../fixtures/rule-tester.ts"
import { at, fixtureHfs, typedTester } from "../fixtures/typed/tester.ts"
import { aiClientThroughGateway, aiVirtualKeyName, PROVIDER_KEY_VARIABLES, providerKeyCustody, RETIRED_KEY_VARIABLES, rules, VIRTUAL_KEY_VARIABLE } from "./ai-gateway.ts"
import { infraImportOwner } from "./infra-owner.ts"

const tester = canonRuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
    settings: { starci: { hfs: fixtureHfs() } },
})
const typed = typedTester()

const CUSTODY = at("src/modules/integrations/ai-gateway/ai-gateway.config.ts")
const CUSTODY_SPEC = at("src/modules/integrations/ai-gateway/ai-gateway.config.spec.ts")
const AI = at("src/modules/integrations/ai/ai.client.ts")
const AI_CONFIG = at("src/modules/integrations/ai/ai.config.ts")
const AI_SPEC = at("src/modules/integrations/ai/ai.client.spec.ts")
const DOMAIN = at("src/modules/domain/order/order.service.ts")
const CONFIG = at("src/modules/platform/config/env-source.config.ts")
const OTHER = at("src/modules/integrations/payos/payos.config.ts")
const ENV = at("apps/api/src/api.env.ts")
const WORLD = at("src/tests/world/use-test-world.ts")

test("the law publishes its two rules under their names", () => {
    assert.equal(rules["provider-key-custody"], providerKeyCustody)
    assert.equal(rules["ai-client-through-gateway"], aiClientThroughGateway)
    assert.equal(rules["ai-virtual-key-name"], aiVirtualKeyName)
    assert.equal(VIRTUAL_KEY_VARIABLE, "STARCI_AI_KEY")
    assert.deepEqual([...RETIRED_KEY_VARIABLES], ["AI_API_KEY", "OPENCLAW_AI_KEY", "AI_ROUTER_ADMIN_TOKEN"])
    assert.ok(PROVIDER_KEY_VARIABLES.includes("OPENROUTER_API_KEY") && PROVIDER_KEY_VARIABLES.includes("OPENAI_API_KEY"))
})

test("provider-key-custody: only the gateway's custody owner names a provider key", () => {
    tester.run("provider-key-custody", providerKeyCustody, {
        valid: [
            { filename: CUSTODY, code: `export const parse = (env: { secret(key: string): unknown }) => ({ openrouter: env.secret("OPENROUTER_API_KEY") })` },
            { filename: CUSTODY, code: "export const file = `OPENAI_API_KEY_FILE`" },
            { filename: CUSTODY_SPEC, code: `export const values = { OPENROUTER_API_KEY: "test" }` },
            // the gateway's own virtual key and base URL are what the rest of the app reads
            { filename: AI, code: `export const parse = (env: { secret(key: string): unknown; url(key: string): string }) => ({ key: env.secret("AI_GATEWAY_KEY"), url: env.url("AI_GATEWAY_URL") })` },
            // a word that only contains a key name is not the key
            { filename: DOMAIN, code: `export const label = "OPENAI_API_KEY is held by the gateway"` },
        ],
        invalid: [
            { filename: AI, code: `export const parse = (env: { secret(key: string): unknown }) => env.secret("OPENAI_API_KEY")`, errors: [{ messageId: "custody" }] },
            { filename: OTHER, code: "export const key = `OPENROUTER_API_KEY`", errors: [{ messageId: "custody" }] },
            { filename: ENV, code: `export const file = "ANTHROPIC_API_KEY_FILE"`, errors: [{ messageId: "custody" }] },
            { filename: CONFIG, code: `export const read = () => process.env.OPENAI_API_KEY`, errors: [{ messageId: "custody" }] },
            { filename: DOMAIN, code: `export const read = (env: Record<string, string>) => { const { GEMINI_API_KEY } = env; return GEMINI_API_KEY }`, errors: [{ messageId: "custody" }] },
            { filename: AI_SPEC, code: `export const values = { key: "OPENROUTER_API_KEY" }`, errors: [{ messageId: "custody" }] },
            { filename: WORLD, code: `export const env = ["OPENAI_API_KEY"]`, errors: [{ messageId: "custody" }] },
            { filename: DOMAIN, code: `export const values = { OPENAI_API_KEY: 1 }`, errors: [{ messageId: "custody" }] },
        ],
    })
})

test("ai-virtual-key-name: integrations/ai reads STARCI_AI_KEY, no file names a retired key, the gateway gets no admin token", () => {
    const parse = (body: string) => `export const parse = (env: { secret(key: string): unknown; url(key: string): string; has(key: string): boolean }) => (${body})`
    tester.run("ai-virtual-key-name", aiVirtualKeyName, {
        valid: [
            { filename: AI_CONFIG, code: parse(`{ url: env.url("AI_BASE_URL"), key: env.has("STARCI_AI_KEY") ? env.secret("STARCI_AI_KEY") : null }`) },
            { filename: AI_CONFIG, code: parse("{ key: env.secret(`STARCI_AI_KEY`) }") },
            // the gateway's custody mounts the same key and reads the upstream keys, which are another rule's
            { filename: CUSTODY, code: parse(`{ mounted: env.secret("STARCI_AI_KEY"), upstream: env.secret("OPENROUTER_API_KEY") }`) },
            { filename: CUSTODY, code: `export const gateway = { keysPath: "keys.sqlite", mountedKeys: [] }` },
            // a secret of another integration is not the virtual key
            { filename: OTHER, code: parse(`{ key: env.secret("PAYOS_API_KEY") }`) },
            // a name that only contains a retired one is not it
            { filename: DOMAIN, code: `export const names = ["OPENAI_API_KEY", "STARCI_AI_KEY", "MY_AI_API_KEY_LABEL"]` },
            { filename: DOMAIN, code: `export const config = { adminToken: "x" }` },
        ],
        invalid: [
            { filename: AI_CONFIG, code: parse(`{ key: env.secret("AI_GATEWAY_KEY") }`), errors: [{ messageId: "name", data: { name: "AI_GATEWAY_KEY" } }] },
            { filename: AI_CONFIG, code: parse(`{ key: env.secret("AI_API_KEY") }`), errors: [{ messageId: "retired" }] },
            { filename: AI_CONFIG, code: `const NAME = "STARCI_AI_KEY"
${parse("{ key: env.secret(NAME) }")}`, errors: [{ messageId: "dynamic" }] },
            { filename: CUSTODY, code: parse(`{ admin: env.secret("AI_ROUTER_ADMIN_TOKEN") }`), errors: [{ messageId: "retired" }] },
            { filename: CUSTODY, code: `export const gateway = (token: string) => ({ keysPath: "keys.sqlite", adminToken: token })`, errors: [{ messageId: "adminToken" }] },
            { filename: DOMAIN, code: "export const key = `OPENCLAW_AI_KEY_FILE`", errors: [{ messageId: "retired" }] },
            { filename: CONFIG, code: `export const read = () => process.env.AI_API_KEY`, errors: [{ messageId: "retired" }] },
            { filename: WORLD, code: `export const values = { OPENCLAW_AI_KEY: "sk-starci-test" }`, errors: [{ messageId: "retired" }] },
            { filename: AI_SPEC, code: `export const env = { AI_ROUTER_ADMIN_TOKEN: "x" }`, errors: [{ messageId: "retired" }] },
        ],
    })
})

const IMPORTS = [
    'import { ChatOpenAI, OpenAIEmbeddings, AzureChatOpenAI } from "@langchain/openai"',
    'import * as lc from "@langchain/openai"',
    'import type { AiOptions } from "@modules/integrations/ai/ai.options"',
    'import { Secret } from "@modules/platform/config/env-source.config"',
].join("\n")

/** A client file of the fixture integration with `body` inside a class that holds the injected options. */
const client = (body: string) => `${IMPORTS}\nexport class AiClient {\n    constructor(private readonly options: AiOptions) {}\n    ${body}\n}\n`

test("ai-client-through-gateway: the LangChain clients point at the gateway with the virtual key", () => {
    typed.run("ai-client-through-gateway", aiClientThroughGateway, {
        valid: [
            { filename: AI, code: client("chat = new ChatOpenAI({ model: this.options.chatModel, apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: this.options.gatewayUrl } })") },
            { filename: AI, code: client('embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small", apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: this.options.gatewayUrl } })') },
            { filename: AI, code: client("chat = new lc.ChatOpenAI({ model: this.options.chatModel, apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: this.options.gatewayUrl } })") },
            // a local class that happens to be called ChatOpenAI is not the library's
            { filename: DOMAIN, code: "class ChatOpenAI { constructor(readonly x: number) {} }\nexport const chat = new ChatOpenAI(1)" },
        ],
        invalid: [
            {
                filename: AI,
                code: client('chat = new ChatOpenAI({ model: this.options.chatModel, apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: "https://openrouter.ai/api/v1" } })'),
                errors: [{ messageId: "baseUrl" }],
            },
            {
                filename: AI,
                code: client("chat = new ChatOpenAI({ model: this.options.chatModel, apiKey: this.options.virtualKey.reveal() })"),
                errors: [{ messageId: "baseUrl" }],
            },
            {
                filename: AI,
                code: client("chat = new ChatOpenAI({ model: this.options.chatModel, configuration: { baseURL: this.options.gatewayUrl } })"),
                errors: [{ messageId: "apiKey" }],
            },
            {
                filename: AI,
                code: client('chat = new ChatOpenAI({ model: this.options.chatModel, apiKey: "sk-starci-app-0000", configuration: { baseURL: this.options.gatewayUrl } })'),
                errors: [{ messageId: "apiKey" }],
            },
            {
                filename: AI,
                code: client("url = `http://127.0.0.1:3002/v1`\n    chat = new ChatOpenAI({ model: this.options.chatModel, apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: this.url } })"),
                errors: [{ messageId: "baseUrl" }],
            },
            {
                filename: AI,
                code: client("chat = new ChatOpenAI({ ...{ model: this.options.chatModel }, apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: this.options.gatewayUrl } })"),
                errors: [{ messageId: "inline" }],
            },
            { filename: AI, code: client("chat = new ChatOpenAI()"), errors: [{ messageId: "inline" }] },
            { filename: AI, code: client("chat = new AzureChatOpenAI({ model: this.options.chatModel })"), errors: [{ messageId: "client" }] },
            {
                filename: AI,
                code: client('embeddings = new lc.OpenAIEmbeddings({ apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: "https://api.openai.com/v1" } })'),
                errors: [{ messageId: "baseUrl" }],
            },
        ],
    })
})

test("infra-import-owner: LangChain lives in integrations/ai, the gateway in its custody owner, and no provider SDK or agent framework anywhere", () => {
    tester.run("infra-import-owner", infraImportOwner, {
        valid: [
            { filename: AI, code: `import { ChatOpenAI } from "@langchain/openai"\nimport { ChatPromptTemplate } from "@langchain/core/prompts"\nexport { ChatOpenAI, ChatPromptTemplate }` },
            { filename: AI, code: `import { BaseRetriever } from "@langchain/core/retrievers"\nexport { BaseRetriever }` },
            { filename: CUSTODY, code: `import { AiRouterModule, AiRouterGatewayModule } from "@starci/ai-router"\nexport { AiRouterModule, AiRouterGatewayModule }` },
            { filename: AI_SPEC, code: `import { AiRouterTestingModule } from "@starci/ai-router/testing"\nexport { AiRouterTestingModule }` },
        ],
        invalid: [
            { filename: DOMAIN, code: `import { ChatOpenAI } from "@langchain/openai"\nexport { ChatOpenAI }`, errors: [{ messageId: "foreign" }] },
            { filename: CUSTODY, code: `import { ChatPromptTemplate } from "@langchain/core/prompts"\nexport { ChatPromptTemplate }`, errors: [{ messageId: "foreign" }] },
            { filename: AI, code: `import { AiRouterGatewayModule } from "@starci/ai-router"\nexport { AiRouterGatewayModule }`, errors: [{ messageId: "foreign" }] },
            { filename: AI, code: `import OpenAI from "openai"\nexport { OpenAI }`, errors: [{ messageId: "nowhere" }] },
            { filename: AI, code: `import { StateGraph } from "@langchain/langgraph"\nexport { StateGraph }`, errors: [{ messageId: "nowhere" }] },
            { filename: AI, code: `import { createAgent } from "langchain"\nexport { createAgent }`, errors: [{ messageId: "nowhere" }] },
            { filename: AI, code: `import { PGVectorStore } from "@langchain/community/vectorstores/pgvector"\nexport { PGVectorStore }`, errors: [{ messageId: "nowhere" }] },
            { filename: CUSTODY, code: `import Anthropic from "@anthropic-ai/sdk"\nexport { Anthropic }`, errors: [{ messageId: "nowhere" }] },
            { filename: AI, code: `import { generateText } from "ai"\nimport { openai } from "@ai-sdk/openai"\nexport { generateText, openai }`, errors: [{ messageId: "nowhere" }, { messageId: "nowhere" }] },
        ],
    })
})
