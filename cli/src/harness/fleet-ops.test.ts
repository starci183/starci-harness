// The ops/ folder of the fleet (the gitignored ops/vps/servers and cloudflare.enc.yaml): STARCI_OPS_DIR, else the harness home of the working
// folder, never the copy a published CLI carries beside itself. Fixture folders only. Built with the CLI, run by `npm test`.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { locateFleetOps } from "./vps/policy.js"

/** An ops/ folder as locateFleetOps accepts it: checks.yaml, the op README and vps.yaml. */
const opsAt = (dir: string): string => {
    mkdirSync(join(dir, "ops", "ops"), { recursive: true })
    writeFileSync(join(dir, "ops", "checks.yaml"), "schema: fixture\n")
    writeFileSync(join(dir, "ops", "ops", "README.md"), "# fixture\n")
    writeFileSync(join(dir, "ops", "vps.yaml"), "schema: fixture\n")
    return join(dir, "ops")
}

void test("the fleet's ops/ is STARCI_OPS_DIR, else the harness home of the working folder, never a published copy", (t) => {
    const root = mkdtempSync(join(tmpdir(), "starci-fleet-ops-"))
    const saved = process.env.STARCI_OPS_DIR
    t.after(() => {
        if (saved === undefined) delete process.env.STARCI_OPS_DIR
        else process.env.STARCI_OPS_DIR = saved
        rmSync(root, { recursive: true, force: true })
    })
    delete process.env.STARCI_OPS_DIR
    const home = join(root, ".claude")
    mkdirSync(join(home, "cli"), { recursive: true })
    mkdirSync(join(home, "policy"), { recursive: true })
    writeFileSync(join(home, "policy", "quality.yaml"), "schema: fixture\n")
    const homeOps = opsAt(home)
    const published = opsAt(join(root, "app", "node_modules", "starci-harness"))
    assert.equal(locateFleetOps(join(root, "app")), homeOps, "below a folder whose .claude is a checkout, its ops/")
    assert.notEqual(locateFleetOps(join(root, "app", "node_modules", "starci-harness")), published, "a published copy is never the fleet")
    const declared = opsAt(join(root, "declared"))
    process.env.STARCI_OPS_DIR = declared
    assert.equal(locateFleetOps(join(root, "app")), declared, "STARCI_OPS_DIR wins")
})
