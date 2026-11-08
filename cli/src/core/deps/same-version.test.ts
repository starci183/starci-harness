// Local and prod builds are one version: `deps publish-local` publishes the committed version (refused when npm serves it with other content),
// an install from the local registry satisfies a `~` peer, `--restore` leaves npm's resolved and integrity, and the push gate refuses a lockfile
// that holds anything else. The install and restore run real npm against an in-process registry on 127.0.0.1 (and npmjs for the restore).
// Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureNpm } from "../../shared/exec.js"
import { captureGitSync } from "../../shared/git.js"
import type { WorkspacePackage } from "../../shared/workspace.js"
import { installLocal, installRecordFile, restoreLocal } from "./install-local.js"
import { judgeLocalRegistry, NPMJS_FLAGS } from "./local-refs.js"
import { integrityMismatches, judgeLockIntegrity } from "./lock-integrity.js"
import { installFlags, registryUrl } from "./local-registry.js"
import { lockedPackages, withoutLocked } from "./lockfile.js"
import { npmCopy } from "./npm-copy.js"
import type { NpmCopy } from "./npm-copy.js"
import { sourceDigest } from "./pack-stamped.js"
import { judgeVersion, planOne } from "./publish-local.js"

const refusal = (code: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === code

const DIGEST = "a".repeat(64)
const OTHER = "b".repeat(64)

interface Cleanup {
    after: (fn: () => void) => void
}

void test("a version npm does not serve, or serves with the same source digest, is published; any other content is refused", () => {
    assert.equal(judgeVersion("@starci/hfs", "6.2.3", DIGEST, undefined), "unserved")
    assert.equal(judgeVersion("@starci/hfs", "6.2.3", DIGEST, { integrity: "sha512-x", source: DIGEST }), "same source")
    assert.throws(
        () => judgeVersion("@starci/hfs", "6.2.3", DIGEST, { integrity: "sha512-x", source: OTHER }),
        (error: unknown) => refusal("PUBLISH_LOCAL_VERSION_TAKEN")(error) && error instanceof Error && error.message.includes("raise the version"),
    )
    assert.throws(
        () => judgeVersion("@starci/hfs", "6.2.3", DIGEST, { integrity: "sha512-x", source: undefined }),
        (error: unknown) => refusal("PUBLISH_LOCAL_VERSION_TAKEN")(error) && error instanceof Error && error.message.includes("no source digest"),
    )
})

const harnessCheckout = (t: Cleanup): { root: string; pkg: WorkspacePackage } => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "starci-same-version-")))
    t.after(() => {
        rmSync(root, { recursive: true, force: true })
    })
    const dir = join(root, "packages", "x")
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "@starci/x", version: "1.2.3" }, null, 2)}\n`)
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 1\n")
    assert.equal(captureGitSync(["init", "-q", "-b", "main", root], root).exitCode, 0)
    assert.equal(captureGitSync(["-C", root, "add", "."], root).exitCode, 0)
    assert.equal(captureGitSync(["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], root).exitCode, 0)
    return { root, pkg: { dir, relativeDir: "packages/x", name: "@starci/x", version: "1.2.3", private: false, scripts: {}, requires: {}, peers: {}, fileDependencies: [], dependsOn: [], entries: [], hasTsconfig: false, hasEslintConfig: false, workspaceRoot: false } }
}

void test("publish-local plans the committed version, never a -local one, and judges it against npm", async (t) => {
    const { root, pkg } = harnessCheckout(t)
    const digest = await sourceDigest(root, "packages/x")
    const unserved = await planOne(root, pkg, { served: () => Promise.resolve(undefined), listed: undefined })
    assert.deepEqual({ ...unserved }, { package: "@starci/x", version: "1.2.3", dir: "packages/x", npm: "unserved", replaces: undefined, served: undefined })
    const same: NpmCopy = { integrity: "sha512-x", source: digest }
    const asked = (served: NpmCopy | undefined, listed: readonly string[]) => ({ served: () => Promise.resolve(served), listed: () => Promise.resolve(listed) })
    const rebuilt = await planOne(root, pkg, asked(same, ["1.2.3"]))
    assert.equal(rebuilt.version, "1.2.3")
    assert.equal(rebuilt.npm, "same source")
    assert.equal(rebuilt.replaces, true, "a rebuild of the version replaces the registry's copy")
    assert.equal((await planOne(root, pkg, asked(undefined, ["1.2.2"]))).replaces, false)
    await assert.rejects(planOne(root, pkg, asked({ integrity: "sha512-x", source: OTHER }, [])), refusal("PUBLISH_LOCAL_VERSION_TAKEN"))
    writeFileSync(join(root, "packages", "x", "src", "a.ts"), "export const a = 2\n")
    await assert.rejects(planOne(root, pkg, asked(same, [])), refusal("PUBLISH_LOCAL_VERSION_TAKEN"), "a changed source no longer matches the copy npm serves")
})

void test("an install names the registry for @starci always and for starci-harness alone by an explicit flag", () => {
    const url = registryUrl(4873)
    assert.deepEqual(installFlags(4873, ["@starci/hfs"]), [`--@starci:registry=${url}`, "--replace-registry-host=never"])
    assert.deepEqual(installFlags(4873, ["@starci/hfs", "starci-harness"]), [`--@starci:registry=${url}`, "--replace-registry-host=never", `--registry=${url}`])
    assert.deepEqual(installFlags(4873), [`--@starci:registry=${url}`, "--replace-registry-host=never"])
})

/** One version a fake registry serves: its manifest and the tarball `npm pack` made of it. */
interface Served {
    readonly manifest: Record<string, unknown>
    readonly tarball: Buffer
}

const scratch = (t: Cleanup): string => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-same-version-app-")))
    const saved = { STARCI_LOCAL_ROOT: process.env.STARCI_LOCAL_ROOT, STARCI_CACHE_HOME: process.env.STARCI_CACHE_HOME }
    process.env.STARCI_LOCAL_ROOT = join(base, "state")
    process.env.STARCI_CACHE_HOME = join(base, "cache")
    t.after(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) Reflect.deleteProperty(process.env, key)
            else process.env[key] = value
        }
        rmSync(base, { recursive: true, force: true })
    })
    return base
}

const packedName = (stdout: string): string => {
    const parsed: unknown = JSON.parse(stdout)
    const first: unknown = Array.isArray(parsed) ? parsed[0] : undefined
    return typeof first === "object" && first !== null && "filename" in first && typeof first.filename === "string" ? first.filename : ""
}

/** Packs `manifest` with npm into a tarball. */
const pack = async (base: string, manifest: Record<string, unknown>): Promise<Served> => {
    const dir = join(base, "packed", `${String(manifest.name).replaceAll(/\W/g, "-")}-${String(manifest.version)}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest))
    writeFileSync(join(dir, "index.js"), `module.exports = ${JSON.stringify(manifest.version)}\n`)
    const run = await captureNpm(["pack", "--pack-destination", dir, "--json", "--ignore-scripts"], dir)
    assert.equal(run.exitCode, 0, run.stderr)
    return { manifest, tarball: readFileSync(join(dir, packedName(run.stdout).replaceAll("/", "-").replace(/^@/, ""))) }
}

const bare = (name: string): string => name.replace(/^@[^/]+\//, "")

/** An npm registry in this process on 127.0.0.1: the packuments (with a `local` dist-tag) and tarballs of the given versions. */
const registry = async (t: Cleanup, packages: Readonly<Record<string, readonly Served[]>>, tag: Readonly<Record<string, string>>): Promise<number> => {
    const server = createServer((request, response) => {
        const path = decodeURIComponent((request.url ?? "/").slice(1))
        if (path === "-/ping") {
            response.end("{}")
            return
        }
        const tarball = /^(.+)\/-\/(.+)-(\d[^/]*)\.tgz$/.exec(path)
        if (tarball !== null) {
            const found = packages[tarball[1] ?? ""]?.find((one) => one.manifest.version === tarball[3])
            if (found === undefined) response.writeHead(404).end()
            else response.writeHead(200, { "content-type": "application/octet-stream" }).end(found.tarball)
            return
        }
        const served = packages[path]
        if (served === undefined) {
            response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
            return
        }
        const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
        const versions = Object.fromEntries(
            served.map((one) => {
                const version = String(one.manifest.version)
                const dist = { tarball: `${origin}/${path}/-/${bare(path)}-${version}.tgz`, integrity: `sha512-${createHash("sha512").update(one.tarball).digest("base64")}`, shasum: createHash("sha1").update(one.tarball).digest("hex") }
                return [version, { ...one.manifest, dist }]
            }),
        )
        const tags = { latest: String(served[0]?.manifest.version), ...(tag[path] === undefined ? {} : { local: tag[path] }) }
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: path, versions, "dist-tags": tags }))
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    t.after(() => {
        server.close()
        server.closeAllConnections()
    })
    return (server.address() as AddressInfo).port
}

/** An app repository whose lockfile npm wrote from the registry on `port`, tracked by git. */
const app = async (base: string, manifest: Record<string, unknown>, port: number): Promise<string> => {
    const root = join(base, "app")
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "app", version: "1.0.0", private: true, ...manifest }, null, 2)}\n`)
    assert.equal(captureGitSync(["init", "-q", "-b", "main", root], base).exitCode, 0)
    const lock = await captureNpm(["install", "--package-lock-only", "--no-audit", "--no-fund", ...installFlags(port, ["starci-harness"])], root)
    assert.equal(lock.exitCode, 0, lock.stderr)
    assert.equal(captureGitSync(["-C", root, "add", "package.json", "package-lock.json"], base).exitCode, 0)
    return root
}

const lockEntry = (root: string, name: string) => lockedPackages(readFileSync(join(root, "package-lock.json"), "utf8"), "package-lock.json").find((one) => one.name === name)

const devDependencies = (root: string): Record<string, string> => {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    return typeof parsed === "object" && parsed !== null && "devDependencies" in parsed ? (parsed.devDependencies as Record<string, string>) : {}
}

void test("an install of the committed version from the local registry satisfies a ~ peer and resolves from the registry", async (t) => {
    const base = scratch(t)
    const canon = await pack(base, { name: "@starci/canon", version: "1.0.0", peerDependencies: { "@starci/hfs": "~6.2.0" } })
    const hfs = [await pack(base, { name: "@starci/hfs", version: "6.2.2" }), await pack(base, { name: "@starci/hfs", version: "6.2.3" })]
    const port = await registry(t, { "@starci/hfs": hfs, "@starci/canon": [canon] }, { "@starci/hfs": "6.2.3" })
    const root = await app(base, { devDependencies: { "@starci/canon": "1.0.0", "@starci/hfs": "6.2.2" } }, port)
    const result = await installLocal(root, [{ name: "@starci/hfs", version: undefined }], port, true)
    assert.deepEqual(result.data.installed, [{ name: "@starci/hfs", version: "6.2.3" }])
    assert.deepEqual(devDependencies(root), { "@starci/canon": "1.0.0", "@starci/hfs": "6.2.3" })
    const installed: unknown = JSON.parse(readFileSync(join(root, "node_modules", "@starci", "hfs", "package.json"), "utf8"))
    assert.deepEqual(installed, { name: "@starci/hfs", version: "6.2.3" })
    assert.ok(lockEntry(root, "@starci/hfs")?.resolved?.startsWith(registryUrl(port)), "the lock entry names the registry")
    assert.ok(readFileSync(installRecordFile(root), "utf8").includes('"spec": "6.2.2"'), "the record keeps the pin it replaced")
})

void test("a build under a -local version satisfies no ~ peer: the install fails on the peer conflict (ERESOLVE), which a real version avoids", async (t) => {
    const base = scratch(t)
    const canon = await pack(base, { name: "@starci/canon", version: "1.0.0", peerDependencies: { "@starci/hfs": "~6.2.0" } })
    const hfs = [await pack(base, { name: "@starci/hfs", version: "6.2.2" }), await pack(base, { name: "@starci/hfs", version: "6.2.4-local.1" })]
    const port = await registry(t, { "@starci/hfs": hfs, "@starci/canon": [canon] }, { "@starci/hfs": "6.2.4-local.1" })
    const root = await app(base, { devDependencies: { "@starci/canon": "1.0.0", "@starci/hfs": "6.2.2" } }, port)
    await assert.rejects(
        installLocal(root, [{ name: "@starci/hfs", version: undefined }], port, true),
        (error: unknown) => refusal("DEPS_INSTALL_FAILED")(error) && error instanceof Error && error.message.includes("Conflicting peer dependency"),
    )
    assert.equal(devDependencies(root)["@starci/hfs"], "6.2.2", "a failed install puts the pins back")
})

void test("starci-harness, the unscoped package, resolves from the registry on an explicit flag for that command", async (t) => {
    const base = scratch(t)
    const cli = await pack(base, { name: "starci-harness", version: "1.1.0-alpha.92" })
    const port = await registry(t, { "starci-harness": [cli] }, { "starci-harness": "1.1.0-alpha.92" })
    const root = await app(base, { devDependencies: { "starci-harness": "1.1.0-alpha.92" } }, port)
    await installLocal(root, [{ name: "starci-harness", version: undefined }], port, true)
    assert.ok(lockEntry(root, "starci-harness")?.resolved?.startsWith(registryUrl(port)))
})

void test("restore reinstalls the same version from npm: the lockfile holds npm's resolved and integrity", async (t) => {
    const base = scratch(t)
    const tsconfig = await pack(base, { name: "@starci/tsconfig", version: "2.1.1" })
    const port = await registry(t, { "@starci/tsconfig": [tsconfig] }, { "@starci/tsconfig": "2.1.1" })
    const root = await app(base, { devDependencies: { "@starci/tsconfig": "2.1.1" } }, port)
    await installLocal(root, [{ name: "@starci/tsconfig", version: undefined }], port, true)
    const local = lockEntry(root, "@starci/tsconfig")
    assert.ok(local?.resolved?.startsWith(registryUrl(port)))
    const served = await npmCopy(root, "@starci/tsconfig", "2.1.1")
    assert.ok(served?.integrity !== undefined)
    assert.notEqual(local?.integrity, served.integrity, "the local build is another tarball of the same version")
    const restored = await restoreLocal(root)
    assert.deepEqual(restored.data.restored, ["@starci/tsconfig"])
    const npm = lockEntry(root, "@starci/tsconfig")
    assert.equal(npm?.version, "2.1.1")
    assert.equal(npm.integrity, served.integrity)
    assert.ok(npm.resolved?.startsWith("https://registry.npmjs.org/"), npm.resolved)
    assert.equal(devDependencies(root)["@starci/tsconfig"], "2.1.1")
    assert.equal(captureGitSync(["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "restored"], base).exitCode, 0)
    await judgeLocalRegistry(root, "HEAD")
    await judgeLockIntegrity(root, "HEAD")
})

const lock = (entries: Record<string, { version?: string; resolved?: string; integrity?: string }>): string => `${JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "app" }, ...entries } }, null, 2)}\n`

const NPM = "https://registry.npmjs.org/@starci/hfs/-/hfs-6.2.2.tgz"
const LOCAL = "http://127.0.0.1:4873/@starci/hfs/-/hfs-6.2.2.tgz"

void test("a lockfile drops only the entries asked for and keeps its own indent and line ending", () => {
    const text = lock({
        "node_modules/@starci/hfs": { version: "6.2.2", resolved: LOCAL, integrity: "sha512-local" },
        "node_modules/zod": { version: "4.6.7", resolved: "https://registry.npmjs.org/zod/-/zod-4.6.7.tgz", integrity: "sha512-z" },
    })
    const kept = withoutLocked(text, "package-lock.json", (one) => one.resolved?.startsWith("http://127.0.0.1") === true)
    assert.deepEqual(kept.dropped, ["node_modules/@starci/hfs"])
    assert.deepEqual(
        lockedPackages(kept.text, "package-lock.json").map((one) => one.name),
        ["zod"],
    )
    assert.equal(withoutLocked(text, "package-lock.json", () => false).text, text)
    const crlf = text.replaceAll("\n", "\r\n")
    assert.equal(withoutLocked(crlf, "package-lock.json", (one) => one.name === "zod").text, withoutLocked(text, "package-lock.json", (one) => one.name === "zod").text.replaceAll("\n", "\r\n"))
})

/** What npm serves, by name@version, for the gate's specs. */
const npmServes =
    (table: Readonly<Record<string, string>>) =>
    (name: string, version: string): Promise<NpmCopy | undefined> => {
        const integrity = table[`${name}@${version}`]
        return Promise.resolve(integrity === undefined ? undefined : { integrity, source: undefined })
    }

void test("a harness package locked with an integrity other than npm's for its version is a mismatch; npm's, an unserved version and other packages are not", async () => {
    const text = lock({
        "node_modules/@starci/hfs": { version: "6.2.2", resolved: NPM, integrity: "sha512-mine" },
        "fe/node_modules/@starci/grammar": { version: "0.25.2", resolved: "https://registry.npmjs.org/@starci/grammar/-/grammar-0.25.2.tgz", integrity: "sha512-grammar" },
        "node_modules/starci-harness": { version: "1.1.0-alpha.91", resolved: "https://registry.npmjs.org/starci-harness/-/starci-harness-1.1.0-alpha.91.tgz", integrity: "sha512-cli" },
        "node_modules/@starci/next": { version: "9.9.9", resolved: "https://registry.npmjs.org/@starci/next/-/next-9.9.9.tgz", integrity: "sha512-unserved" },
        "node_modules/zod": { version: "4.6.7", resolved: "https://registry.npmjs.org/zod/-/zod-4.6.7.tgz", integrity: "sha512-other" },
        "node_modules/@starci/linked": { version: "1.0.0", resolved: "../linked" },
    })
    const serves = npmServes({ "@starci/hfs@6.2.2": "sha512-npm", "@starci/grammar@0.25.2": "sha512-grammar", "starci-harness@1.1.0-alpha.91": "sha512-clix", "zod@4.6.7": "sha512-never-asked" })
    const lines = await integrityMismatches("package-lock.json", text, serves)
    assert.equal(lines.length, 2)
    assert.ok(lines[0]?.includes("node_modules/@starci/hfs") && lines[0].includes("@starci/hfs@6.2.2"))
    assert.ok(lines[1]?.includes("starci-harness@1.1.0-alpha.91"))
})

void test("the push gate refuses a committed lockfile whose harness integrity is not npm's, and passes npm's", async (t) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "starci-lock-gate-")))
    t.after(() => {
        rmSync(base, { recursive: true, force: true })
    })
    assert.equal(captureGitSync(["init", "-q", "-b", "main", base], base).exitCode, 0)
    const commit = (text: string): void => {
        writeFileSync(join(base, "package-lock.json"), text)
        assert.equal(captureGitSync(["-C", base, "add", "package-lock.json"], base).exitCode, 0)
        assert.equal(captureGitSync(["-C", base, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], base).exitCode, 0)
    }
    commit(lock({ "node_modules/@starci/hfs": { version: "6.2.2", resolved: NPM, integrity: "sha512-npm" } }))
    const serves = npmServes({ "@starci/hfs@6.2.2": "sha512-npm" })
    await judgeLockIntegrity(base, "HEAD", serves)
    commit(lock({ "node_modules/@starci/hfs": { version: "6.2.2", resolved: NPM, integrity: "sha512-built-locally" } }))
    await assert.rejects(judgeLockIntegrity(base, "HEAD", serves), (error: unknown) => refusal("DEPS_LOCK_INTEGRITY")(error) && error instanceof Error && error.message.includes("deps install-local --restore"))
    await judgeLockIntegrity(base, "HEAD~1", serves)
    commit(lock({ "node_modules/@starci/hfs": { version: "6.2.2", resolved: LOCAL, integrity: "sha512-npm" } }))
    await assert.rejects(judgeLocalRegistry(base, "HEAD"), refusal("DEPS_LOCAL_REGISTRY_COMMITTED"))
})

void test("every npm question of a gate and the restore name npmjs for the registry and the @starci scope", () => {
    assert.deepEqual([...NPMJS_FLAGS], ["--registry=https://registry.npmjs.org/", "--@starci:registry=https://registry.npmjs.org/"])
})
