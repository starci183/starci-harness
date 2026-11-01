// The local registry of `deps publish-local`: loopback-only by construction, a container found on another interface is refused,
// the npm settings reach `@starci` only. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { CONTAINER, installFlags, installNpmrc, judgeContainer, publishNpmrc, readInspect, registryConfig, registryFlags, registryUrl, runArgv } from "./local-registry.js"

const inspect = (running: boolean, bindings: Record<string, { HostIp: string; HostPort: string }[] | null>): string => JSON.stringify([{ State: { Running: running }, HostConfig: { PortBindings: bindings } }])

void test("the container is created with its port published on 127.0.0.1 only", () => {
    const argv = runArgv(4873, "D:/state/local-registry")
    assert.deepEqual(argv.slice(argv.indexOf("-p"), argv.indexOf("-p") + 2), ["-p", "127.0.0.1:4873:4873"])
    assert.equal(argv.filter((one) => one === "-p").length, 1)
    assert.ok(argv.includes(CONTAINER))
    assert.ok(argv.some((one) => one.endsWith(":/verdaccio/conf:ro")))
    assert.equal(registryUrl(4999), "http://127.0.0.1:4999/")
})

void test("the config proxies to npmjs, allows no new users and has no login", () => {
    const config = registryConfig()
    assert.match(config, /url: https:\/\/registry\.npmjs\.org\//)
    assert.match(config, /max_users: -1/)
    assert.match(config, /proxy: npmjs/)
})

void test("an app install reaches only @starci, the CLI's own calls reach everything", () => {
    assert.equal(installNpmrc(4873), "@starci:registry=http://127.0.0.1:4873/\nreplace-registry-host=never\n")
    assert.ok(!installNpmrc(4873).includes("\nregistry="))
    assert.match(publishNpmrc(4873), /^registry=http:\/\/127\.0\.0\.1:4873\/$/m)
    assert.deepEqual(installFlags(4873), ["--@starci:registry=http://127.0.0.1:4873/", "--replace-registry-host=never"])
    assert.deepEqual(registryFlags(4873).slice(0, 1), ["--registry=http://127.0.0.1:4873/"])
})

void test("a container published on all interfaces or another address is refused, a loopback one passes", () => {
    const open = readInspect(inspect(true, { "4873/tcp": [{ HostIp: "0.0.0.0", HostPort: "4873" }] }))
    assert.throws(() => { judgeContainer(open, 4873) }, (error: unknown) => error instanceof Error && "code" in error && error.code === "LOCAL_REGISTRY_EXPOSED")
    const unset = readInspect(inspect(true, { "4873/tcp": [{ HostIp: "", HostPort: "4873" }] }))
    assert.throws(() => { judgeContainer(unset, 4873) }, (error: unknown) => error instanceof Error && "code" in error && error.code === "LOCAL_REGISTRY_EXPOSED")
    const lan = readInspect(inspect(true, { "4873/tcp": [{ HostIp: "192.168.1.5", HostPort: "4873" }] }))
    assert.throws(() => { judgeContainer(lan, 4873) }, (error: unknown) => error instanceof Error && "code" in error && error.code === "LOCAL_REGISTRY_EXPOSED")
    const good = readInspect(inspect(false, { "4873/tcp": [{ HostIp: "127.0.0.1", HostPort: "4873" }] }))
    assert.equal(good.running, false)
    judgeContainer(good, 4873)
    assert.throws(() => { judgeContainer(good, 4999) }, (error: unknown) => error instanceof Error && "code" in error && error.code === "LOCAL_REGISTRY_PORT")
})

void test("docker output that is not an inspect document is refused", () => {
    assert.throws(() => readInspect("[]"), (error: unknown) => error instanceof Error && "code" in error && error.code === "DOCKER_INSPECT_UNREADABLE")
    assert.throws(() => readInspect("nope"), (error: unknown) => error instanceof Error && "code" in error && error.code === "DOCKER_INSPECT_UNREADABLE")
})
