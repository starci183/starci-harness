// The build order of a CI package job: a sibling a package installs or builds against comes before it, even when the specs of the
// two read each other's files. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { buildEdges, buildOrder } from "./affected.js"

const need = (hard: readonly string[], soft: readonly string[] = []): { readonly hard: ReadonlySet<string>; readonly soft: ReadonlySet<string> } => ({
    hard: new Set(hard),
    soft: new Set(soft),
})

void test("a file: sibling is built before its dependent although the sibling's specs read the dependent's files", () => {
    // core imports fe through `file:` and fe's specs read ../core/: the install edge wins, whichever package starts the walk.
    const edges = buildEdges(
        new Map([
            ["packages/fe", need(["packages/tsconfig"], ["packages/core"])],
            ["packages/core", need(["packages/fe", "packages/tsconfig"])],
            ["packages/pop", need(["packages/core", "packages/fe"])],
            ["packages/tsconfig", need([])],
        ]),
    )
    assert.deepEqual(buildOrder("packages/fe", edges), ["packages/tsconfig", "packages/fe"])
    assert.deepEqual(buildOrder("packages/core", edges), ["packages/tsconfig", "packages/fe", "packages/core"])
    assert.deepEqual(buildOrder("packages/pop", edges), ["packages/tsconfig", "packages/fe", "packages/core", "packages/pop"])
})

void test("a relative read that closes no cycle still orders its sibling first", () => {
    const edges = buildEdges(new Map([["packages/a", need([], ["packages/b"])], ["packages/b", need([])]]))
    assert.deepEqual(buildOrder("packages/a", edges), ["packages/b", "packages/a"])
})

void test("two siblings that only read each other still get one deterministic order", () => {
    const edges = buildEdges(new Map([["packages/a", need([], ["packages/b"])], ["packages/b", need([], ["packages/a"])]]))
    assert.deepEqual(buildOrder("packages/a", edges), ["packages/b", "packages/a"])
    assert.deepEqual(buildOrder("packages/b", edges), ["packages/b"])
})
