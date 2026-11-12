// The peer line of a local publish (CONTRIB-20; contexts/authority/packages.md "The local registry"): a published version no sibling release can install beside is refused, a published range
// that excludes the newest line the local registry lists is warned. The registry's listing is read from a packument served in process.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import { registryPeerLine } from "./local-registry.js"
import { judgePeerLine, newestRelease } from "./peer-line.js"
import type { ListedLine } from "./peer-line.js"

const HFS = "@starci/hfs"
const CORE = "@starci/eslint-grammar-core"
const BE = "@starci/eslint-canon-be"
const FE = "@starci/eslint-canon-fe"

const PEERERS = { [CORE]: { [HFS]: "~6.8.0", [FE]: "~9.16.0", eslint: ">=9" }, [BE]: { [HFS]: "~6.8.0", eslint: ">=9" }, [FE]: { [HFS]: "~6.8.0" } }

const registry = (listing: Readonly<Record<string, ListedLine>>) => (name: string): ListedLine => listing[name]

void test("an hfs minor that no Grammar lint release peers is refused, naming the sibling and the fix", () => {
    const verdict = judgePeerLine([{ package: HFS, version: "6.8.3", peers: {} }], PEERERS, registry({ [CORE]: { "0.37.36": { [HFS]: "~6.7.0" }, "0.37.38": { [HFS]: "~6.7.0" } }, [BE]: { "3.23.1": { [HFS]: "~6.8.0" } } }))
    assert.equal(verdict.refused.length, 1)
    assert.match(verdict.refused[0] ?? "", /^@starci\/hfs@6\.8\.3: no release of @starci\/eslint-grammar-core .*the newest, @starci\/eslint-grammar-core@0\.37\.38, peers @starci\/hfs ~6\.7\.0.*raise @starci\/eslint-grammar-core's peer range/u)
})

void test("the same hfs is clean once a Grammar lint release of its line is listed or published with it", () => {
    const listed = registry({ [CORE]: { "0.37.38": { [HFS]: "~6.7.0" }, "0.37.37": { [HFS]: "~6.8.0" } } })
    assert.deepEqual(judgePeerLine([{ package: HFS, version: "6.8.5", peers: {} }], PEERERS, listed), { refused: [], warned: [] })
    const together = judgePeerLine(
        [
            { package: HFS, version: "6.9.0", peers: {} },
            { package: CORE, version: "0.37.39", peers: { [HFS]: "~6.9.0" } },
        ],
        PEERERS,
        registry({ [CORE]: { "0.37.38": { [HFS]: "~6.8.0" } } }),
    )
    assert.deepEqual(together, { refused: [], warned: [] })
})

void test("a sibling published with hfs whose range excludes it is refused even when an older listed release admits it", () => {
    const verdict = judgePeerLine(
        [
            { package: HFS, version: "6.8.5", peers: {} },
            { package: CORE, version: "0.37.39", peers: { [HFS]: "~6.7.0" } },
        ],
        PEERERS,
        registry({ [CORE]: { "0.37.37": { [HFS]: "~6.8.0" } } }),
    )
    assert.equal(verdict.refused.length, 1)
    assert.match(verdict.refused[0] ?? "", /@starci\/eslint-grammar-core@0\.37\.39, published with it, peers @starci\/hfs ~6\.7\.0, which excludes it/u)
})

void test("a Grammar lint cut on an older hfs minor is warned with the newest hfs release the registry lists", () => {
    const verdict = judgePeerLine([{ package: CORE, version: "0.37.38", peers: { [HFS]: "~6.7.0", [FE]: "~9.16.0", eslint: ">=9" } }], PEERERS, registry({ [HFS]: { "6.7.1": {}, "6.8.4": {}, "5.2.1-rootpkgs.1": {} }, [FE]: { "9.16.15": { [HFS]: "~6.8.0" } } }))
    assert.deepEqual(verdict.refused, [])
    assert.deepEqual(verdict.warned, ["@starci/eslint-grammar-core@0.37.38 peers @starci/hfs ~6.7.0, which excludes @starci/hfs@6.8.4, the newest the local registry lists: an app on that line cannot install it; cut it on the newest line too"])
})

void test("a sibling the registry does not list, and a peer outside the workspace, are left alone", () => {
    assert.deepEqual(judgePeerLine([{ package: HFS, version: "7.0.0", peers: {} }], PEERERS, registry({})), { refused: [], warned: [] })
    assert.deepEqual(judgePeerLine([{ package: BE, version: "3.23.2", peers: { [HFS]: "~6.8.0", eslint: ">=9" } }], PEERERS, registry({ [HFS]: { "6.8.5": {} } })), { refused: [], warned: [] })
})

void test("the newest release ignores a pre-release and orders by number, not text", () => {
    assert.equal(newestRelease({ "6.10.0": {}, "6.9.9": {}, "7.0.0-rc.1": {} }), "6.10.0")
    assert.equal(newestRelease(undefined), undefined)
})

void test("the registry's listing is read from its packument: each version with its peer ranges, undefined on a 404", async (context) => {
    const server = createServer((request, response) => {
        if (request.url === "/@starci%2feslint-grammar-core") {
            response.writeHead(200, { "content-type": "application/json" })
            response.end(JSON.stringify({ name: CORE, versions: { "0.37.38": { version: "0.37.38", peerDependencies: { [HFS]: "~6.7.0" } }, "0.37.2": { version: "0.37.2" } } }))
            return
        }
        response.writeHead(404)
        response.end()
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    context.after(() => server.close())
    const port = (server.address() as AddressInfo).port
    assert.deepEqual(await registryPeerLine(CORE, port), { "0.37.38": { [HFS]: "~6.7.0" }, "0.37.2": {} })
    assert.equal(await registryPeerLine(HFS, port), undefined)
})
