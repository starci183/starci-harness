---
slots: [be.integrations, be.integrations.model]
---
# Model calls

How a back end calls a language or embedding model: every call goes through the `@starci/ai-router` gateway, code
calls it through LangChain from one integration, and open tool-using work belongs to the agent runtime. Which owner
may import a model library is the infrastructure table (`ruleParams.be.infraOwners` of
[hfs/slots.yaml](../../hfs/slots.yaml), BE-INFRA-1); the provider key list is the canon's
(`@starci/eslint-canon-be src/ai-gateway.ts` `PROVIDER_KEY_VARIABLES`).

Library APIs were read from the LangChain JS documentation on 2026-10-29 (`@langchain/openai` 1.8.0,
`@langchain/core` 1.3.1): ChatOpenAI at docs.langchain.com/oss/javascript/integrations/chat/openai, OpenAIEmbeddings at
docs.langchain.com/oss/javascript/integrations/text_embedding/openai, structured output at
docs.langchain.com/oss/javascript/langchain/models, retrievers at reference.langchain.com/javascript/langchain-core/retrievers/BaseRetriever.
Re-read them before raising either pin.

## BE-AI-1 Every model call goes through the ai-router gateway, and only its custody reads a provider key

The app hosts the gateway in process: `integrations/ai-gateway` registers `AiRouterModule` (the provider pool) and
`AiRouterGatewayModule` with `listen: true`, so the gateway serves the OpenAI-compatible API on the app's port plus one
(owner: `@starci/ai-router src/ai-router-gateway.listen.ts`). That owner is the custody of the upstream keys: its
`ai-gateway.config.ts` reads them as `Secret` (BE-CONFIG-3, sealed by BE-CONFIG-4) and hands them to the pool through
`resolve`. Every client, the app's own LangChain integration and the agent runtime alike, authenticates with a
gateway-issued virtual key (`sk-starci-...`) bound to its profiles and quota; no other file, spec or runtime holds a
provider key, and no provider SDK is imported anywhere.

Why: one door for every call gives one place for keys, quotas, failover and usage, and a leaked client key is revoked
at the gateway without touching a provider.

Enforced by: `provider-key-custody` (R326), `infra-import-owner` (R90: `@starci/ai-router` in the custody owner, every
provider SDK and `openai` nowhere).

## BE-AI-2 Choose: a code chain or the agent runtime

Work splits by its shape, never by convenience:

| the work | runs in | through |
| --- | --- | --- |
| a fixed-shape task: classify, extract, draft, parse a rule, summarise to a schema, embed | a LangChain chain of `integrations/ai`, called by the domain service that owns the data (BE-AI-4) | the gateway, with the app's virtual key |
| an answer grounded in the app's knowledge | the same chain with a retriever the caller scopes (BE-AI-5) | the gateway, with the app's virtual key |
| an open, multi-step conversation that decides which tools to call | the agent runtime (openclaw), outside the app (BE-AI-6) | the single MCP gateway for every tool, the ai-router gateway with its own virtual key for every model call |

A task whose steps code can list is a chain, even when it calls the model twice; a task whose next step depends on
what a tool returned is the runtime's. Code never runs an agent loop, and the runtime never writes business data
directly.

Why: a chain is testable, bounded and typed like any service call; an agent loop is not, so it runs where authority and
audit sit at every tool call.

Enforced by: `infra-import-owner` (R90: `langchain` and `@langchain/langgraph` nowhere); the choice itself is review only.

## BE-AI-3 One integration owns LangChain, and its clients point at the gateway

`integrations/ai` is the only owner of `@langchain/*`. Its `ai.config.ts` parses the gateway's base URL (`env.url`, no
default) and the virtual key (`env.secret`); its `ai.client.ts` builds exactly two clients, `ChatOpenAI` and
`OpenAIEmbeddings`, with `configuration.baseURL` from those options and `apiKey` revealed from the `Secret`. A missing
base URL would reach the provider directly and a missing key would read `OPENAI_API_KEY`, so both are written out. The
model name is a gateway profile or pool alias, never a provider's model id baked into code.

Why: LangChain is the protocol code speaks; holding it in one owner keeps one configuration, one failure mapping into
the integration's error family (BE-INFRA-3) and one upgrade path.

Enforced by: `infra-import-owner` (R90), `ai-client-through-gateway` (R327).

## BE-AI-4 A domain task is a chain: prompt, model, parser, then code's fixed tail

Each task is one method of the integration's client: a `ChatPromptTemplate` (`@langchain/core/prompts`) declared in
`<task>.templates.ts`, piped to the chat model, then to `withStructuredOutput(schema, { name })` for a typed result
(the schema in `<task>.schema.ts`, bounded by R304 and R305) or to `StringOutputParser`
(`@langchain/core/output_parsers`) for text. The chain returns what the model produced; what must always be there (a
disclaimer, a signature, a link, a status line) is appended by code after the answer, never asked of the model. A
failure becomes the integration's error with its cause.

```ts
/** Classifies a support message into the catalog's categories; a refusal or a gateway failure is an AiError. */
async classifyMessage(input: ClassifyMessageInput): Promise<MessageCategory> {
    const chain = classifyMessagePrompt.pipe(this.chat.withStructuredOutput(messageCategorySchema, { name: "classify_message" }))
    return chain.invoke({ message: input.text }).catch((cause: unknown) => {
        throw new AiError({ code: AiErrorCode.Unavailable, cause })
    })
}

/** Drafts a reply from the retrieved passages and appends the fixed footer the model never writes. */
async draftReply(input: DraftReplyInput): Promise<string> {
    const chain = draftReplyPrompt.pipe(this.chat).pipe(new StringOutputParser())
    const passages = await new KnowledgeRetriever(input.retrieve).invoke(input.question)
    const answer = await chain.invoke({ question: input.question, context: passages.map((passage) => passage.pageContent).join("\n\n") })
    return `${answer}\n\n${input.footer}`
}
```

with the clients built once from the injected options:

```ts
this.chat = new ChatOpenAI({ model: this.options.chatModel, apiKey: this.options.virtualKey.reveal(), configuration: { baseURL: this.options.gatewayUrl } })
```

Why: a fixed shape is a contract, so the parser checks it and the caller gets a type; a fixed tail written by code is
exact every time, which a model's echo is not.

Enforced by: `schema-place`, `schema-bounded` (R304, R305) for the schema; the chain shape is review only.

## BE-AI-5 Context comes from a retriever the caller scopes to its access lane

Grounding is retrieval-augmented: the chain takes its context from a retriever, a `BaseRetriever`
(`@langchain/core/retrievers`, implementing `_getRelevantDocuments`) in `<name>.adapter.ts` of `integrations/ai`,
built over a `retrieve(query)` function the calling domain service passes in. The domain owns the knowledge, its
pgvector query (BE-PERSISTENCE, embeddings from the integration's `OpenAIEmbeddings`) and the resource check: the
function it hands over is already scoped to the caller's access lane (BE-AUTH-2), so a passage the caller may not read
never reaches the prompt. The integration imports no domain code (BE-ARCHITECTURE-1) and keeps no vector store of its
own.

Why: a prompt is an output channel; context fetched outside the caller's authority leaks through the answer.

Enforced by: `infra-import-owner` (R90: `@langchain/community` nowhere), `tier-direction` (R26); the scoping is review only.

## BE-AI-6 The agent runtime acts only through the MCP gateway

Open work runs in the agent runtime. Each of its tools is a tool of the single MCP gateway, which authenticates the
agent, applies the same authorization as every other door (BE-AUTH-1, BE-AUTH-2) and writes the audit row; its
catalog is the committed `be.contract.mcp-tools` snapshot (R302). The runtime calls models through the same ai-router
gateway with its own virtual key, holds no database credential and changes business data only through a tool, which
runs the app's use case. The app neither embeds the runtime nor calls back into it from a chain.

Why: every effect an agent has then passes the checks a human's request passes, and is attributable after the fact.

Enforced by: R302 (hfs `mcp-tools-snapshot`) for the catalog; the runtime's credentials and tool routing are review only.
