// The gate that keeps a registry on this machine out of committed files: lockfile `resolved` URLs and .npmrc registries.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGitSync } from "../../shared/git.js"
import { isLoopbackHost, judgeLocalRegistry, localReferences, NPMJS_FLAGS } from "./local-refs.js"

const lock = (resolved: string): string => `{\n  "packages": {\n    "node_modules/@starci/grammar": {\n      "version": "0.21.0",\n      "resolved": "${resolved}"\n    }\n  }\n}\n`

void test("a loopback host is this machine in any spelling", () => {
    for (const host of ["localhost", "localhost.", "127.0.0.1", "127.1.2.3", "[::1]", "::1", "0.0.0.0", "registry.localhost", "registry.localhost.", "host.docker.internal"]) assert.equal(isLoopbackHost(host), true, host)
    for (const host of ["registry.npmjs.org", "example.com", "127.0.0.1.example.com", ["10", "0", "0", "5"].join(".")]) assert.equal(isLoopbackHost(host), false, host)
})

void test("a lockfile resolved to a local registry is found, one resolved to npm is not", () => {
    assert.equal(localReferences("package-lock.json", lock("http://127.0.0.1:4873/@starci/grammar/-/grammar-0.21.0.tgz")).length, 1)
    assert.equal(localReferences("fe/package-lock.json", lock("http://localhost:4873/@starci/grammar/-/grammar-0.21.0.tgz"))[0]?.line, 5)
    assert.equal(localReferences("package-lock.json", lock("https://registry.npmjs.org/@starci/grammar/-/grammar-0.20.2.tgz")).length, 0)
    assert.equal(localReferences("package-lock.json", lock("file:../grammar")).length, 0)
})

void test("every resolved URL is judged in a compact lockfile, including JSON-escaped URLs", () => {
    const first = "http://localhost:4873/@starci/grammar/-/grammar-0.21.0.tgz"
    const second = "http://127.0.0.1:4873/@starci/hfs/-/hfs-4.16.5.tgz"
    const compact = JSON.stringify({ packages: {
        "node_modules/react": { resolved: "https://registry.npmjs.org/react/-/react-19.0.0.tgz" },
        "node_modules/@starci/grammar": { resolved: first },
        "node_modules/@starci/hfs": { resolved: second },
    } }).replace("localhost", String.raw`local\u0068ost`)
    assert.deepEqual(localReferences("package-lock.json", compact), [
        { file: "package-lock.json", line: 1, url: first },
        { file: "package-lock.json", line: 1, url: second },
    ])
    assert.equal(localReferences("package-lock.json", compact).length, 2)
})

void test("a resolved value split from its key keeps the key's diagnostic line", () => {
    const text = '{\n  "resolved":\n    "http:\\/\\/localhost:4873/pkg.tgz"\n}\n'
    assert.deepEqual(localReferences("npm-shrinkwrap.json", text), [{ file: "npm-shrinkwrap.json", line: 2, url: "http://localhost:4873/pkg.tgz" }])
})

void test("an .npmrc registry on this machine is found, scoped or not", () => {
    assert.equal(localReferences(".npmrc", "@starci:registry=http://127.0.0.1:4873/\n").length, 1)
    assert.equal(localReferences("fe/.npmrc", "registry = http://localhost:4873/\n").length, 1)
    assert.equal(localReferences(".npmrc", "install-links=true\n@starci:registry=https://registry.npmjs.org/\n").length, 0)
    assert.equal(localReferences("notes.md", "@starci:registry=http://127.0.0.1:4873/\n").length, 0)
    for (const setting of ['registry="http://localhost:4873/"', "@starci:registry='http://127.0.0.1:4873/'", String.raw`registry="http://local\u0068ost:4873/"`]) {
        assert.equal(localReferences(".npmrc", setting).length, 1, setting)
    }
})

void test("every npm question of a gate is pinned to the public registry", () => {
    assert.deepEqual(NPMJS_FLAGS, ["--registry=https://registry.npmjs.org/", "--@starci:registry=https://registry.npmjs.org/"])
})

void test("a committed lockfile that resolves to a local registry refuses the push, a clean one passes", async () => {
    const root = mkdtempSync(join(tmpdir(), "starci-local-refs-"))
    try {
        const run = (...args: string[]): void => {
            const result = captureGitSync(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], root)
            assert.equal(result.exitCode, 0, result.stderr)
        }
        run("init", "-q")
        writeFileSync(join(root, "package-lock.json"), lock("https://registry.npmjs.org/@starci/grammar/-/grammar-0.20.2.tgz"))
        run("add", ".")
        run("commit", "-q", "-m", "clean")
        await judgeLocalRegistry(root, "HEAD")
        writeFileSync(join(root, "package-lock.json"), lock("http://127.0.0.1:4873/@starci/grammar/-/grammar-0.21.0.tgz"))
        run("commit", "-q", "-am", "local")
        await assert.rejects(judgeLocalRegistry(root, "HEAD"), (error: unknown) => error instanceof Error && "code" in error && error.code === "DEPS_LOCAL_REGISTRY_COMMITTED" && error.message.includes("package-lock.json:5"))
        await judgeLocalRegistry(root, "HEAD~1")
        const registry = new URL("http://localhost:4873/private-registry?auth=fixture-query#fixture-fragment")
        registry.username = "fixture-user"
        registry.password = "fixture-password"
        writeFileSync(join(root, ".npmrc"), `registry="${registry.href}"\n`)
        run("add", ".npmrc")
        run("commit", "-q", "-m", "quoted local registry")
        await assert.rejects(judgeLocalRegistry(root, "HEAD"), (error: unknown) => {
            assert.ok(error instanceof Error)
            assert.match(error.message, /\.npmrc:1 http:\/\/localhost:4873/)
            assert.doesNotMatch(error.message, /fixture-user|fixture-password|private-registry|fixture-query|fixture-fragment/)
            return true
        })
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
