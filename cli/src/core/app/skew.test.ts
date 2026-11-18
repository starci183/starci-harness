// HFS_CLI_HFS_SKEW: a CLI that is not the app's pinned starci-harness, or loaded another @starci/hfs than it requires, says so (core/app/skew.ts).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { appPinnedCli, cliHfsSkew, installedCli, loadedHfs, requiredHfs, SKEW_CODE, writes } from "./skew.js"

const same = { cli: "1.1.0-alpha.160", hfsWanted: "6.13.40", hfsLoaded: "6.13.40", pinned: "1.1.0-alpha.160" }

void test("the CLI the app pins, running the hfs it requires, is no skew; outside an app nothing is judged", () => {
    assert.equal(cliHfsSkew(same), null)
    assert.equal(cliHfsSkew({ ...same, pinned: undefined, cli: "9.9.9" }), null)
})

void test("a CLI of another version than the app pins is a coded skew that names the app's own CLI", () => {
    const skew = cliHfsSkew({ ...same, pinned: "1.1.0-alpha.155" })
    assert.ok(skew)
    assert.equal(skew.code, SKEW_CODE)
    assert.match(skew.message, /HFS_CLI_HFS_SKEW: this CLI is starci-harness 1\.1\.0-alpha\.160 \(@starci\/hfs 6\.13\.40\) but the app pins starci-harness 1\.1\.0-alpha\.155/u)
    assert.match(skew.message, /npx --no-install starci <verb>/u)
})

void test("a stale or hoisted @starci/hfs under the right CLI is a skew too", () => {
    const skew = cliHfsSkew({ ...same, hfsLoaded: "6.13.30" })
    assert.match(skew?.message ?? "", /loaded is 6\.13\.30, not the 6\.13\.40 it requires/u)
    assert.equal(cliHfsSkew({ ...same, hfsLoaded: undefined }), null, "an unreadable copy is not called a skew")
})

void test("a stale install under the app is a skew whichever CLI runs: its hooks run the older copy", () => {
    const skew = cliHfsSkew({ ...same, installed: "1.1.0-alpha.150" })
    assert.match(skew?.message ?? "", /node_modules holds starci-harness 1.1.0-alpha.150, not its pin 1.1.0-alpha.160/u)
    assert.equal(cliHfsSkew({ ...same, installed: "1.1.0-alpha.160" }), null)
    assert.equal(cliHfsSkew({ ...same, installed: undefined }), null, "no install is no skew")
    const root = mkdtempSync(join(tmpdir(), "starci-skew-"))
    try {
        assert.equal(installedCli(root), undefined)
        mkdirSync(join(root, "node_modules", "starci-harness"), { recursive: true })
        writeFileSync(join(root, "node_modules", "starci-harness", "package.json"), JSON.stringify({ version: "1.1.0-alpha.150" }))
        assert.equal(installedCli(root), "1.1.0-alpha.150")
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

void test("the app's pin is the exact starci-harness dependency of its package.json, never a range", () => {
    const root = mkdtempSync(join(tmpdir(), "starci-skew-"))
    try {
        assert.equal(appPinnedCli(root), undefined)
        writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { "starci-harness": "1.1.0-alpha.155" } }))
        assert.equal(appPinnedCli(root), "1.1.0-alpha.155")
        writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { "starci-harness": "^1.1.0" } }))
        assert.equal(appPinnedCli(root), undefined)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

// A release train bumps the in-repo hfs before its cli-follow raises the CLI's requirement, so the two may differ in a train build;
// they agree in a published install, which is what cliHfsSkew judges at run time.
void test("this build knows the hfs it requires and the hfs it loads", () => {
    assert.match(requiredHfs() ?? "", /^\d+\.\d+\.\d+/u)
    assert.match(loadedHfs() ?? "", /^\d+\.\d+\.\d+/u)
})

void test("only the writes into an app are refused under a skew", () => {
    assert.equal(writes("sync", ["--execute"]), true)
    assert.equal(writes("sync", []), false)
    assert.equal(writes("check", ["--fix"]), true)
    assert.equal(writes("check", ["--env", "prod"]), false)
    assert.equal(writes("audit", ["--execute"]), false)
})
