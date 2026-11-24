// A dev sync restarts the processes the app declares (not `api` and `web` assumed), stops only the strays of the checkout (never a recorded process,
// its children or a web's edge; a copy listening on a declared port is one), and runs npm ci again when an antivirus held a file. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import test from "node:test"
import { declaredOf, processesOfApp } from "./declared.js"
import { npmCiRetried, processesFor } from "./sync.js"
import { strayDevServers } from "./sync-runner.js"
import type { HostProcess } from "../../harness/process-table.js"

const DEFAULTS = { be: ["api"], fe: ["web"] }

const NEXT = {
    environments: {
        dev: {
            local: {
                ports: { core: 3201, app: 3200, landing: 3202 },
                processes: [
                    { name: "core", cwd: "be", port: "core" },
                    { name: "app", cwd: "fe/apps/app", port: "app" },
                    { name: "landing", cwd: "fe/apps/landing", port: "landing" },
                    { name: "gallery", cwd: "gallery", port: 3550 },
                ],
            },
        },
    },
}

void test("an app that declares core, app, landing and gallery restarts those, by the side each runs; settings that name declared processes stand", () => {
    const declared = declaredOf(NEXT, "dev")
    assert.deepEqual(declared, [
        { name: "core", side: "be", port: 3201 },
        { name: "app", side: "fe", port: 3200 },
        { name: "landing", side: "fe", port: 3202 },
        { name: "gallery", side: "both", port: 3550 },
    ])
    const processes = processesOfApp(DEFAULTS, declared)
    assert.deepEqual(processesFor(["fe"], processes), ["app", "landing", "gallery"])
    assert.deepEqual(processesFor(["be"], processes), ["core", "gallery"])
    assert.deepEqual(processesOfApp({ be: ["core"], fe: ["app"] }, declared), { be: ["core"], fe: ["app"] }, "a deliberate choice of declared names is kept")
    assert.deepEqual(processesOfApp(DEFAULTS, undefined), DEFAULTS, "no declaration: the settings")
    assert.equal(declaredOf(NEXT, "prod"), undefined)
})

void test("a stray is a dev server or a declared port's listener of the checkout that is neither recorded, a recorded process's child, nor an edge", () => {
    const row = (pid: number, ppid: number, commandLine: string): HostProcess => ({ pid, ppid, name: "node.exe", workingSetMb: 100, commandLine, cpuMs: null, startedMs: null, cwd: null })
    const table = [
        row(20, 1, String.raw`cmd /c npm run start --prefix D:\next\devstack\fe\apps\app`),
        row(21, 20, String.raw`node D:\next\devstack\node_modules\next\dist\bin\next start -p 3200`),
        row(30, 1, String.raw`node D:\next\devstack\node_modules\next\dist\bin\next start -p 3200`),
        row(31, 1, String.raw`node D:\next\devstack\be\dist\apps\core\src\main.js`),
        row(32, 1, String.raw`node D:\next\devstack\node_modules\@starci\hfs\stack\edge-server.mjs`),
        row(33, 1, String.raw`node D:\other\be\dist\apps\core\src\main.js`),
    ]
    assert.deepEqual(strayDevServers(table, "D:/next/devstack", new Set([20]), 1, new Set([31, 32, 33])).map((one) => one.pid), [30, 31])
})

void test("npm ci is run again up to four times when it dies on a held file (ENOTEMPTY, EPERM), never for another failure", async () => {
    let calls = 0
    const pauses: number[] = []
    await npmCiRetried("C:/nowhere-for-the-spec", () => {
        calls += 1
        return calls < 3 ? Promise.reject(new Error("npm ci: ENOTEMPTY: directory not empty, rmdir node_modules/ajv-formats/node_modules/ajv")) : Promise.resolve()
    }, (ms) => {
        pauses.push(ms)
        return Promise.resolve()
    })
    assert.equal(calls, 3)
    assert.deepEqual(pauses, [5000, 10_000])
    let held = 0
    await assert.rejects(npmCiRetried("C:/nowhere-for-the-spec", () => {
        held += 1
        return Promise.reject(new Error("EPERM: operation not permitted, unlink lightningcss.win32-x64-msvc.node"))
    }, () => Promise.resolve()), /EPERM/u)
    assert.equal(held, 4)
    let other = 0
    await assert.rejects(npmCiRetried("C:/nowhere-for-the-spec", () => {
        other += 1
        return Promise.reject(new Error("npm error code ERESOLVE"))
    }, () => Promise.resolve()), /ERESOLVE/u)
    assert.equal(other, 1)
})
