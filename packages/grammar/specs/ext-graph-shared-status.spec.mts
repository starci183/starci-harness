import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { KIND_TONES, focusStep, STATUS_TONE, kindTone, edgeClassName, edgeStyleOf, findConcurrentRunning, isEdgeAnimated, nodeAriaLabel, nodeClassName, normalizeKind, normalizeStatus, statusTone, tileTone } from "../src/core/ext/graph/shared/status.ts"
import { FLOW_STATUSES, type FlowStatusInput } from "../src/core/ext/graph/types.ts"

describe("status to tone and class", () => {
    it("has exactly six states, each in a Grammar tone", () => {
        assert.deepEqual(
            FLOW_STATUSES.map((status) => [status, statusTone(status)]),
            [
                ["done", "success"],
                ["running", "success"],
                ["wait", "warning"],
                ["error", "danger"],
                ["skipped", "muted"],
                ["todo", "default"],
            ],
        )
        assert.equal(Object.keys(STATUS_TONE).length, 6)
    })

    it("maps the older run words and a missing status", () => {
        assert.equal(normalizeStatus(undefined), "todo")
        assert.deepEqual(
            (["running", "waiting", "failed", "idle", "skipped", "done", "wait", "todo", "error"] as const).map((word) => normalizeStatus(word)),
            ["running", "wait", "error", "todo", "skipped", "done", "wait", "todo", "error"],
        )
    })

    it("names the node class by its status", () => {
        assert.equal(nodeClassName("error"), "starci-graph-node starci-graph-node--error")
    })

    it("names a node by its label and its status word", () => {
        assert.equal(nodeAriaLabel("Send mail", "waiting"), "Send mail, waiting")
    })
})

describe("kinds and the tone of a tile", () => {
    it("reads the older lane kinds as the step kinds", () => {
        assert.deepEqual(
            (["trigger", "execute", "output", "event", "condition", undefined] as const).map((kind) => normalizeKind(kind)),
            ["event", "action", "end", "event", "condition", undefined],
        )
    })

    it("plates the tile in the tone of the state unless the node has its own tone; a kind only names its legend swatch", () => {
        assert.equal(tileTone("danger", "done"), "danger")
        assert.equal(tileTone(undefined, "done"), "success")
        assert.equal(tileTone(undefined, "running"), "success")
        assert.equal(kindTone("event", { event: "info" }), "info")
        assert.equal(kindTone("trigger"), KIND_TONES.event)
    })
})

describe("the edge rule", () => {
    it("animates only while the step it leads into runs; the edge into a waiting step is still", () => {
        assert.deepEqual(
            FLOW_STATUSES.filter((status) => isEdgeAnimated(status)),
            ["running"],
        )
    })

    it("draws an edge from its variant, else from the step it leads into", () => {
        assert.equal(edgeStyleOf("taken", "done", "running"), "taken")
        assert.equal(edgeStyleOf(undefined, "done", "running"), "running")
        assert.equal(edgeStyleOf(undefined, "done", "wait"), "wait")
        assert.equal(edgeStyleOf(undefined, "done", "done", true), "taken")
        assert.equal(edgeStyleOf(undefined, "done", "todo", true), "pending")
        assert.equal(edgeStyleOf(undefined, "todo", "todo", true), "pending")
        assert.equal(edgeStyleOf(undefined, "done"), "plain")
        assert.equal(edgeStyleOf(undefined, undefined), "plain")
        assert.equal(edgeClassName("skipped"), "starci-graph-edge starci-graph-edge--skipped")
    })
})

describe("two running nodes on one path", () => {
    it("finds a running node upstream of another, once", () => {
        const nodes = [{ id: "a", status: "running" as const }, { id: "b", status: "done" as const }, { id: "c", status: "running" as const }]
        assert.deepEqual(findConcurrentRunning(nodes, [{ source: "a", target: "b" }, { source: "b", target: "c" }]), [["a", "c"]])
    })

    it("lets two branches each run and ignores a back edge and a single runner", () => {
        const nodes = [{ id: "a", status: "done" as const }, { id: "b", status: "running" as const }, { id: "c", status: "running" as const }]
        assert.deepEqual(findConcurrentRunning(nodes, [{ source: "a", target: "b" }, { source: "a", target: "c" }]), [])
        assert.deepEqual(findConcurrentRunning(nodes, [{ source: "b", target: "c", variant: "back" }]), [])
        assert.deepEqual(findConcurrentRunning([{ id: "a", status: "running" }], []), [])
    })
})

describe("the step the first view is centred on", () => {
    it("is the running one, else a failed one, else a waiting one, else the first not done, else the first", () => {
        const at = (statuses: readonly (FlowStatusInput | undefined)[]): string | undefined => focusStep(statuses.map((status, index) => ({ id: String(index), status })))
        assert.equal(at(["done", "wait", "running", "todo"]), "2")
        assert.equal(at(["done", "todo", "error", "wait"]), "2")
        assert.equal(at(["done", "todo", "wait"]), "2")
        assert.equal(at(["done", "skipped", "todo", "todo"]), "2")
        assert.equal(at(["done", "done"]), "0")
        assert.equal(at([]), undefined)
    })
})
