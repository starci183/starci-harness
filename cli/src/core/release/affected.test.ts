// The build order of a CI package job: a sibling a package installs or builds against comes before it, even when the specs of the
// two read each other's files. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { buildEdges, buildOrder } from "./affected.js"

const need = (
    hard: readonly string[],
    soft: readonly string[] = [],
    built: readonly string[] = [],
): { readonly hard: ReadonlySet<string>; readonly built: ReadonlySet<string>; readonly soft: ReadonlySet<string> } => ({
    hard: new Set(hard),
    built: new Set(built),
    soft: new Set([...soft, ...built]),
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
    assert.deepEqual(buildOrder("packages/core", edges), ["packages/tsconfig", "packages/fe", "packages/core"])
    assert.deepEqual(buildOrder("packages/pop", edges), ["packages/tsconfig", "packages/fe", "packages/core", "packages/pop"])
    // fe cannot wait for core, but its specs read core's files: core is still installed and built after fe, before fe's tests.
    assert.deepEqual(buildOrder("packages/fe", edges, ["packages/core"]), ["packages/tsconfig", "packages/fe", "packages/core"])
})

void test("a relative read that closes no cycle still orders its sibling first", () => {
    const edges = buildEdges(new Map([["packages/a", need([], ["packages/b"])], ["packages/b", need([])]]))
    assert.deepEqual(buildOrder("packages/a", edges), ["packages/b", "packages/a"])
})

void test("two siblings that only read each other still get one deterministic order", () => {
    const edges = buildEdges(new Map([["packages/a", need([], ["packages/b"])], ["packages/b", need([], ["packages/a"])]]))
    assert.deepEqual(buildOrder("packages/a", edges, ["packages/b"]), ["packages/b", "packages/a"])
    assert.deepEqual(buildOrder("packages/b", edges, ["packages/a"]), ["packages/b", "packages/a"])
})

void test("a sibling whose dist a package imports is built before it, the sibling reading the package only follows it", () => {
    // hfs's build typechecks against canon-be/dist while canon-be's specs read hfs's files.
    const edges = buildEdges(new Map([["packages/hfs", need([], ["packages/be"], ["packages/be"])], ["packages/be", need([], ["packages/hfs"])]]))
    assert.deepEqual(buildOrder("packages/hfs", edges, ["packages/be"]), ["packages/be", "packages/hfs"])
    assert.deepEqual(buildOrder("packages/be", edges, ["packages/hfs"]), ["packages/be", "packages/hfs"])
})
