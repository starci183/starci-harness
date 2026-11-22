// The sh preflight of `lane land`, `lane gate` and `release gate`: a POSIX sh must resolve on PATH (Git's usr/bin on Windows), else the
// verb refuses HOST_POSIX_SH_MISSING with the fix before any gate runs.
import assert from "node:assert/strict"
import { join } from "node:path"
import test from "node:test"
import { Refusal } from "./errors.js"
import { assertPosixSh, posixShOnPath } from "./posix-sh.js"

const files = (...paths: string[]): ((path: string) => boolean) => {
    const known = new Set(paths)
    return (path) => known.has(path)
}

void test("on Windows sh resolves from Git's usr/bin, the first PATH entry that holds sh.exe", () => {
    const usrBin = String.raw`C:\Program Files\Git\usr\bin`
    const sh = join(usrBin, "sh.exe")
    const env = { Path: String.raw`C:\Windows\System32;C:\Program Files\Git\cmd;"C:\Program Files\Git\usr\bin"`, PATHEXT: ".COM;.EXE" }
    assert.equal(posixShOnPath(env, "win32", files(sh, join(String.raw`C:\Windows\System32`, "bash.exe"))), sh)
})

void test("a PowerShell PATH with Git's cmd/ and WSL's bash only has no sh, and the gate refuses with the fix", () => {
    const env = { Path: String.raw`C:\Windows\System32;C:\Program Files\Git\cmd` }
    const isFile = files(join(String.raw`C:\Windows\System32`, "bash.exe"), join(String.raw`C:\Program Files\Git\cmd`, "git.exe"))
    assert.equal(posixShOnPath(env, "win32", isFile), undefined)
    assert.throws(
        () => assertPosixSh("lane gate", env, "win32", isFile),
        (error: unknown) => error instanceof Refusal && error.code === "HOST_POSIX_SH_MISSING" && error.message.includes(String.raw`usr\bin first on PATH`),
    )
})

void test("elsewhere sh resolves from a colon-separated PATH", () => {
    const sh = join("/usr/bin", "sh")
    assert.equal(posixShOnPath({ PATH: "/opt/none:/usr/bin" }, "linux", files(sh)), sh)
    assert.equal(assertPosixSh("release gate", { PATH: "/usr/bin" }, "linux", files(sh)), sh)
    assert.throws(() => assertPosixSh("the batch lander", { PATH: "/opt/none" }, "linux", files(sh)), /HOST_POSIX_SH_MISSING|needs a POSIX sh/)
})
