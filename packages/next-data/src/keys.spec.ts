import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { tenantKey, tenantParamsKey, tenantRequestKey, viewerCacheKey, viewerKey, viewerKeyId } from "./keys.ts"

describe("viewer keys", () => {
    it("names the viewer part by the user id, the signed-out marker, or nothing before the session answers", () => {
        assert.equal(viewerKeyId("u1"), "u1")
        assert.equal(viewerKeyId(null), "signed-out")
        assert.equal(viewerKeyId(undefined), undefined)
    })

    it("waits for the session answer, then keys the read by the viewer", () => {
        assert.equal(viewerKey("ACCOUNT", undefined), null)
        assert.deepEqual(viewerKey("ACCOUNT", "u1"), ["ACCOUNT", "u1"])
        assert.deepEqual(viewerKey("ACCOUNT", null), ["ACCOUNT", "signed-out"])
    })

    it("gives each viewer, the signed-out state and the pending state a cache identity of their own", () => {
        assert.equal(viewerCacheKey(undefined), "pending")
        assert.equal(viewerCacheKey(null), "signed-out")
        assert.equal(viewerCacheKey("u1"), "u1")
        assert.notEqual(viewerCacheKey("u1"), viewerCacheKey("u2"))
    })
})

describe("tenant keys", () => {
    it("puts the tenant between the name and the arguments, so a switch of tenant reads afresh", () => {
        assert.deepEqual(tenantKey("KNOWLEDGE", "t1", ["page-2", null]), ["KNOWLEDGE", "t1", "page-2", null])
        assert.deepEqual(tenantKey("KNOWLEDGE", "t1", []), ["KNOWLEDGE", "t1"])
        assert.notDeepEqual(tenantKey("KNOWLEDGE", "t1", []), tenantKey("KNOWLEDGE", "t2", []))
    })

    it("waits while the tenant is unknown or the read is disabled", () => {
        assert.equal(tenantKey("KNOWLEDGE", undefined, []), null)
        assert.equal(tenantKey("KNOWLEDGE", "t1", [], false), null)
    })

    it("keys by ordered parameters and pauses on absent parameters or an empty tenant", () => {
        assert.deepEqual(tenantParamsKey("LIST", "t1", ["open", 20]), ["LIST", "t1", "open", 20])
        assert.equal(tenantParamsKey("LIST", "t1", null), null)
        assert.equal(tenantParamsKey("LIST", undefined, ["open"]), null)
        assert.equal(tenantParamsKey("LIST", "", ["open"]), null)
    })

    it("keys by one request object and pauses on a null request or an unknown tenant", () => {
        const request = { from: "2026-01-01" }
        assert.deepEqual(tenantRequestKey("RANGE", "t1", request), ["RANGE", "t1", request])
        assert.equal(tenantRequestKey("RANGE", "t1", null), null)
        assert.equal(tenantRequestKey("RANGE", undefined, request), null)
    })
})
