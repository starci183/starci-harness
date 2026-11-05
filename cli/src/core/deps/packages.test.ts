// A tracked package.json that is a template or a vendored copy is not a manifest the deps verbs read.
import assert from "node:assert/strict"
import test from "node:test"
import { isManifest } from "./packages.js"

void test("the root and workspace package.json files are manifests", () => {
    assert.equal(isManifest("package.json"), true)
    assert.equal(isManifest("packages/grammar/package.json"), true)
})

void test("a vendored copy and a handlebars template are not manifests", () => {
    assert.equal(isManifest("node_modules/x/package.json"), false)
    assert.equal(isManifest("packages/eslint-canon-be/runtime/packages/hfs/templates/app/package-scripts/package.json"), false)
})
