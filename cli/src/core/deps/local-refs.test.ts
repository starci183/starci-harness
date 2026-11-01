// The gate that keeps a registry on this machine out of committed files: lockfile `resolved` URLs and .npmrc registries.
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { isLoopbackHost, judgeLocalRegistry, localReferences, NPMJS_FLAGS } from "./local-refs.js"

const lock = (resolved: string): string => `{\n  "packages": {\n    "node_modules/@starci/grammar": {\n      "version": "0.21.0",\n      "resolved": "${resolved}"\n    }\n  }\n}\n`

void test("a loopback host is this machine in any spelling", () => {
    for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "[::1]", "::1", "0.0.0.0", "registry.localhost", "host.docker.internal"]) assert.equal(isLoopbackHost(host), true, host)
    for (const host of ["registry.npmjs.org", "example.com", "127.0.0.1.example.com", "10.0.0.5"]) assert.equal(isLoopbackHost(host), false, host)
})

void test("a lockfile resolved to a local registry is found, one resolved to npm is not", () => {
    assert.equal(localReferences("package-lock.json", lock("http://127.0.0.1:4873/@starci/grammar/-/grammar-0.21.0.tgz")).length, 1)
    assert.equal(localReferences("fe/package-lock.json", lock("http://localhost:4873/@starci/grammar/-/grammar-0.21.0.tgz"))[0]?.line, 5)
    assert.equal(localReferences("package-lock.json", lock("https://registry.npmjs.org/@starci/grammar/-/grammar-0.20.2.tgz")).length, 0)
    assert.equal(localReferences("package-lock.json", lock("file:../grammar")).length, 0)
})

void test("an .npmrc registry on this machine is found, scoped or not", () => {
    assert.equal(localReferences(".npmrc", "@starci:registry=http://127.0.0.1:4873/\n").length, 1)
    assert.equal(localReferences("fe/.npmrc", "registry = http://localhost:4873/\n").length, 1)
    assert.equal(localReferences(".npmrc", "install-links=true\n@starci:registry=https://registry.npmjs.org/\n").length, 0)
    assert.equal(localReferences("notes.md", "@starci:registry=http://127.0.0.1:4873/\n").length, 0)
})

void test("every npm question of a gate is pinned to the public registry", () => {
    assert.deepEqual(NPMJS_FLAGS, ["--registry=https://registry.npmjs.org/", "--@starci:registry=https://registry.npmjs.org/"])
})

void test("a committed lockfile that resolves to a local registry refuses the push, a clean one passes", async () => {
    const root = mkdtempSync(join(tmpdir(), "starci-local-refs-"))
    try {
        const run = (...args: string[]): void => {
            execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, stdio: "ignore" })
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
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})
