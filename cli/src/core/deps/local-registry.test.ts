// The local registry of `deps publish-local`: one host service (ops/host.yaml `local-registry`, compose file and config in
// ops/host/registry/), loopback-only by construction, the npm settings reach `@starci` only, and its lifecycle (state, an idempotent
// start through `host up`) with the ping and the host start replaced. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import type { UpOutcome } from "../../harness/host.js"
import { ensureRegistry, installFlags, installNpmrc, publishNpmrc, registryFlags, registryFolder, registryState, registryUrl } from "./local-registry.js"
import type { RegistryIo } from "./local-registry.js"

const registryDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "ops", "host", "registry")

const refusal = (code: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === code

/** The registry's process side replaced: the ping answers from `answers` in turn (the last one repeats), and every host start is counted. */
const fake = (...answers: boolean[]): { io: RegistryIo; starts: () => number } => {
    let pings = 0
    let starts = 0
    return {
        io: {
            answers: () => Promise.resolve(answers[Math.min(pings++, answers.length - 1)] ?? false),
            up: (): Promise<readonly UpOutcome[]> => {
                starts += 1
                return Promise.resolve([{ id: "local-registry", outcome: "started", evidence: "fixture" }])
            },
        },
        starts: () => starts,
    }
}

/** Points the state base at a scratch folder for one spec, so no storage folder is made under the real runtime. */
const inScratch = (t: { after: (fn: () => void) => void }): string => {
    const saved = process.env.STARCI_LOCAL_ROOT
    const root = mkdtempSync(join(tmpdir(), "registry-spec-"))
    process.env.STARCI_LOCAL_ROOT = root
    t.after(() => {
        if (saved === undefined) delete process.env.STARCI_LOCAL_ROOT
        else process.env.STARCI_LOCAL_ROOT = saved
        rmSync(root, { recursive: true, force: true })
    })
    return root
}

void test("the compose service pins the image by digest, publishes 127.0.0.1 only and keeps the container name", () => {
    const text = readFileSync(join(registryDir, "compose.yaml"), "utf8")
    assert.match(text, /^\s+image:\s*verdaccio\/verdaccio:\S+@sha256:[0-9a-f]{64}$/m)
    assert.match(text, /^\s+container_name:\s*\$\{STARCI_HOST_PROJECT:-starci\}-local-registry$/m)
    const ports = [...text.matchAll(/^\s+-\s*"([^"]*:\d+:\d+)"$/gm)].map((one) => one[1])
    assert.deepEqual(ports, ["127.0.0.1:4873:4873"])
    assert.match(text, /^\s+restart:\s*unless-stopped$/m)
    assert.match(text, /\.\/config\.yaml:\/verdaccio\/conf\/config\.yaml:ro$/m)
    assert.match(text, /\$\{STARCI_REGISTRY_STORAGE:\?[^}]+\}:\/verdaccio\/storage$/m)
})

void test("the config proxies to npmjs, allows no new users and has no login", () => {
    const config = readFileSync(join(registryDir, "config.yaml"), "utf8")
    assert.match(config, /url: https:\/\/registry\.npmjs\.org\//)
    assert.match(config, /max_users: -1/)
    assert.match(config, /proxy: npmjs/)
})

void test("an app install reaches only @starci, the CLI's own calls reach everything", () => {
    assert.equal(registryUrl(4873), "http://127.0.0.1:4873/")
    assert.equal(installNpmrc(4873), "@starci:registry=http://127.0.0.1:4873/\nreplace-registry-host=never\n")
    assert.ok(!installNpmrc(4873).includes("\nregistry="))
    assert.match(publishNpmrc(4873), /^registry=http:\/\/127\.0\.0\.1:4873\/$/m)
    assert.deepEqual(installFlags(4873), ["--@starci:registry=http://127.0.0.1:4873/", "--replace-registry-host=never"])
    assert.ok(!installFlags(4873, ["@starci/hfs"]).some((flag) => flag.startsWith("--registry=")), "an install of @starci packages never names the registry for everything")
    assert.deepEqual(registryFlags(4873).slice(0, 1), ["--registry=http://127.0.0.1:4873/"])
})

void test("status is up when the ping answers and down when it does not, and starts nothing", async () => {
    const down = fake(false)
    const up = fake(true)
    assert.equal(await registryState(down.io), "down")
    assert.equal(await registryState(up.io), "up")
    assert.equal(down.starts() + up.starts(), 0)
})

void test("start is idempotent: a registry that answers is adopted and the host service is not started", async (t) => {
    const root = inScratch(t)
    const up = fake(true)
    await ensureRegistry(".", up.io)
    await ensureRegistry(".", up.io)
    assert.equal(up.starts(), 0)
    assert.equal(registryFolder(), join(root, "local-registry"))
    assert.ok(existsSync(join(root, "local-registry", "storage")))
})

void test("start runs the host service once when the registry is down, and returns when it then answers", async (t) => {
    inScratch(t)
    const down = fake(false, true)
    await ensureRegistry(".", down.io)
    assert.equal(down.starts(), 1)
})

void test("start refuses LOCAL_REGISTRY_NOT_READY, with the host's evidence, when the registry still does not answer", async (t) => {
    inScratch(t)
    const never = fake(false)
    await assert.rejects(ensureRegistry(".", never.io), (error: unknown) => refusal("LOCAL_REGISTRY_NOT_READY")(error) && error instanceof Error && error.message.includes("local-registry: started (fixture)"))
    assert.equal(never.starts(), 1)
})
