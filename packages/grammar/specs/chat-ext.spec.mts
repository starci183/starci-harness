/**
 * The AI chat extension `@starci/grammar/core/ext/chat`: the thread renders on the server over assistant-ui's external store runtime (the
 * reader's turns as brand bubbles, an assistant turn as markdown with copy and retry, a tool call with its status mark, the thinking mark, the
 * preview card with its one primary, stop in place of send while a run goes), the app's messages convert to assistant-ui's, and the boundary
 * holds (core never imports the extension; @assistant-ui/react only inside it, an exact optional peer).
 *
 *   node --import ./specs/support/register.mts --test specs/chat-ext.spec.mts
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AiChatThread, sendableText, textOfMessage, toolStatusOf, toThreadMessage, type AiChatLabels, type AiChatMessage, type AiChatThreadProps } from "../src/core/ext/chat/index.ts"

const src = fileURLToPath(new URL("../src/", import.meta.url))
const ext = join(src, "core", "ext", "chat")
const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|css)$/.test(name) ? [path] : []
    })
const rel = (path: string): string => relative(src, path).replaceAll("\\", "/")

const labels: AiChatLabels = {
    placeholder: "Ask the assistant", send: "Send", stop: "Stop", retry: "Retry", copy: "Copy", thinking: "Thinking", toolRunning: "Running", toolDone: "Done", toolError: "Failed", empty: "What should this step do?",
}

const conversation: AiChatMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Greet new customers\non the chat channel." }] },
    {
        id: "a1",
        role: "assistant",
        status: "complete",
        parts: [
            { type: "tool-call", toolCallId: "t1", toolName: "contacts.search", title: "Look up new customers", args: { since: "7 days" }, result: { count: 12 }, status: "done" },
            { type: "text", text: "Here is the step:\n\n```ts\nconst hi = 1\n```" },
        ],
    },
]

const render = (overrides: Partial<AiChatThreadProps> = {}): string =>
    renderToStaticMarkup(createElement(AiChatThread, { messages: conversation, isRunning: false, onSend: () => undefined, labels, ...overrides }))

test("a conversation: the reader's turn is a brand bubble at the end side, the answer is markdown with copy and retry, the tool call carries its mark", () => {
    const html = render({ onRetry: () => undefined })
    assert.match(html, /data-component="AiChatThread"/)
    assert.match(html, /data-grammar-bubble-side="outgoing"[^>]*data-grammar-bubble-tone="brand"/)
    assert.match(html, /Greet new customers\non the chat channel\./, "the reader's words keep their line break")
    assert.match(html, /data-grammar-ai-chat-role="assistant"/)
    assert.match(html, /data-component="FencedCodeBlock"|<pre/, "a fence is a code block")
    assert.match(html, /data-grammar-ai-chat-tool="done"/)
    assert.match(html, /Look up new customers/)
    assert.match(html, /aria-label="Copy"/)
    assert.match(html, /aria-label="Retry"/)
    assert.match(html, /data-grammar-composer-send="true"/)
    assert.doesNotMatch(html, /aria-label="Stop"/)
})

test("running: the thinking mark while the answer has nothing yet, stop in place of send, no actions under the streaming turn", () => {
    const asked: AiChatMessage[] = [...conversation, { id: "u2", role: "user", parts: [{ type: "text", text: "Add a voucher." }] }]
    const html = render({ messages: asked, isRunning: true, onStop: () => undefined, onRetry: () => undefined })
    assert.match(html, /data-grammar-ai-chat-thinking="true"/)
    assert.match(html, />Thinking</)
    assert.match(html, /Stop/)
    assert.doesNotMatch(html, /aria-label="Retry"/, "nothing to retry while a run goes")
    assert.match(html, /data-grammar-ai-chat-running="true"/)
})

test("empty, preview and disabled: the app's words, the one primary approve, a read-only composer", () => {
    assert.match(render({ messages: [] }), /What should this step do\?/)
    const preview = render({ preview: { title: "Greeting step", rows: [{ label: "Message", value: "Hi {name}\nWelcome" }], approveLabel: "Approve", reviseLabel: "Revise" }, onApprove: () => undefined, onRevise: () => undefined })
    assert.match(preview, /data-grammar-ai-chat-preview="waiting"/)
    assert.match(preview, /Greeting step/)
    const region = preview.slice(preview.indexOf("data-grammar-ai-chat-preview="), preview.indexOf("starci-ai-chat-composer"))
    assert.equal(region.match(/data-grammar-variant="primary"/g)?.length, 1, "approve is the one primary of the preview region")
    assert.equal(region.match(/data-grammar-variant="border"/g)?.length, 1, "revise is the border look")
    assert.match(preview, />Approve</)
    assert.match(preview, />Revise</)
    const approved = render({ preview: { title: "Greeting step", rows: [], approveLabel: "Approve", reviseLabel: "Revise", approved: true } })
    assert.match(approved, /data-grammar-ai-chat-preview="approved"/)
    assert.doesNotMatch(approved, />Revise</)
    assert.match(render({ disabled: true }), /data-grammar-readonly="true"/)
})

test("the three slots: the assistant's mark before each assistant turn, the node after the messages, the hint under the composer's box", () => {
    const html = render({
        assistantAvatar: { name: "Claude", kind: "logo", src: "/claude.svg" },
        afterMessages: createElement("p", { "data-after": "yes" }, "You approved version 2"),
        composerHint: "Claude · the shop's key",
    })
    assert.equal(html.match(/data-grammar-ai-chat-mark="true"/g)?.length, 1, "one mark for the one assistant turn, none for the reader's")
    assert.match(html, /data-grammar-avatar-size="sm"/, "the mark is the 24px Avatar")
    const column = html.slice(html.indexOf("starci-ai-chat-viewport"), html.indexOf("starci-ai-chat-composer"))
    assert.ok(column.lastIndexOf("data-grammar-ai-chat-role=\"assistant\"") < column.indexOf("data-after=\"yes\""), "the node stands after the last message, inside the thread")
    assert.ok(html.indexOf("data-after=\"yes\"") < html.indexOf("starci-ai-chat-composer"))
    assert.match(html.slice(html.indexOf("starci-ai-chat-composer")), /the shop&#x27;s key|the shop's key/)
    const plain = render()
    assert.doesNotMatch(plain, /data-grammar-ai-chat-mark|data-grammar-ai-chat-after/, "no slot, nothing drawn")
})

test("the app's messages convert to assistant-ui's: ids, roles, text and tool parts, a failed answer incomplete", () => {
    const failed: AiChatMessage = { id: "a2", role: "assistant", status: "error", parts: [{ type: "tool-call", toolCallId: "t2", toolName: "x", title: "X", args: { n: 1, skip: undefined }, status: "error" }] }
    const converted = toThreadMessage(failed)
    assert.equal(converted.id, "a2")
    assert.deepEqual(converted.status, { type: "incomplete", reason: "error" })
    assert.deepEqual(converted.content, [{ type: "tool-call", toolCallId: "t2", toolName: "x", args: { n: 1 }, isError: true }])
    assert.equal(toThreadMessage(conversation[0] as AiChatMessage).status, undefined, "a reader's turn carries no status")
    assert.equal(textOfMessage(conversation[1] as AiChatMessage), "Here is the step:\n\n```ts\nconst hi = 1\n```")
    assert.deepEqual(toolStatusOf("running", labels), { state: "running", label: "Running" })
    assert.equal(sendableText("  hi  ", false, false), "hi")
    assert.equal(sendableText("hi", true, false), null)
    assert.equal(sendableText("hi", false, true), null)
    assert.equal(sendableText("   ", false, false), null)
})

test("core never imports the extension, @assistant-ui/react is imported only inside it, and it is an exact optional peer", async () => {
    for (const file of walk(src)) {
        if (file.startsWith(ext) || /[\\/]stories[\\/]/.test(file)) continue
        const text = readFileSync(file, "utf8")
        assert.doesNotMatch(text, /from\s+["'][^"']*ext\/chat|import\s*\(\s*["'][^"']*ext\/chat/, `${rel(file)} imports the chat extension`)
        assert.doesNotMatch(text, /from\s+["']@assistant-ui\//, `${rel(file)} imports assistant-ui`)
    }
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, Record<string, unknown>>
    assert.match(String(manifest["peerDependencies"]?.["@assistant-ui/react"]), /^\d+\.\d+\.\d+$/)
    assert.deepEqual(manifest["peerDependenciesMeta"]?.["@assistant-ui/react"], { optional: true })
    assert.equal(manifest["dependencies"]?.["@assistant-ui/react"], undefined)
    assert.ok(manifest["exports"]?.["./core/ext/chat"], "the ./core/ext/chat subpath is exported")
    assert.equal(manifest["exports"]?.["./core/ext/chat.css"], "./dist/core/ext/chat/styles.css")
    const { libraryProblem } = await import("../scripts/lint/eslint-plugin.mts")
    assert.equal(libraryProblem("src/core/ext/chat/AiChatThread.tsx", "@assistant-ui/react"), null)
    assert.match(libraryProblem("src/core/leaf/Button/index.tsx", "@assistant-ui/react") ?? "", /only src\/core\/ext\/chat imports it/)
    for (const file of walk(ext)) {
        const text = readFileSync(file, "utf8")
        assert.doesNotMatch(text, /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/, `${rel(file)} holds a hex colour`)
        assert.doesNotMatch(text, /(?:^|[^\w-])(?:rgba?|hsla?|oklch|oklab)\(/, `${rel(file)} holds a colour function`)
    }
})
