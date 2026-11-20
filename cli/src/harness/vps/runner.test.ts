import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// The CI deploy runner's forced command (ops/vps/runner/starci-deploy-gate), run as the real POSIX script: its fixed paths are pointed at a temp
// folder and its one exit (`exec sudo -n /usr/local/sbin/starci-deploy-run`) at an echo, so the spec sees exactly what the gate would hand to root.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const source = readFileSync(join(repo, "ops/vps/runner/starci-deploy-gate"), "utf8")
const shAvailable = spawnSync("sh", ["-c", "exit 0"]).status === 0

function gate(request: string | undefined, apps = ["nivoos-lite"]) {
    const root = mkdtempSync(join(tmpdir(), "runner-gate-"))
    try {
        mkdirSync(join(root, "etc"))
        mkdirSync(join(root, "log"))
        writeFileSync(join(root, "etc/apps"), apps.map((app) => `${app}\n`).join(""))
        const script = source
            .replaceAll("/etc/starci-runner", join(root, "etc").replaceAll("\\", "/"))
            .replaceAll("/var/log/starci-runner", join(root, "log").replaceAll("\\", "/"))
            .replace("exec sudo -n /usr/local/sbin/starci-deploy-run", "exec echo RUN")
        writeFileSync(join(root, "gate.sh"), script)
        const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SSH_CLIENT: "192.0.2.7 50000 22" }
        if (request !== undefined) env.SSH_ORIGINAL_COMMAND = request
        const run = spawnSync("sh", [join(root, "gate.sh")], { env, encoding: "utf8" })
        let log = ""
        try { log = readFileSync(join(root, "log/gate.log"), "utf8") } catch { /* no log line */ }
        return { status: run.status, stdout: run.stdout.trim(), stderr: run.stderr, log }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

test("the gate hands an admitted deploy request to root with its three checked words", { skip: !shAvailable }, () => {
    for (const env of ["staging", "production"]) {
        const run = gate(`deploy nivoos-lite ${env} v0.0.7`)
        assert.equal(run.status, 0, run.stderr)
        assert.equal(run.stdout, `RUN nivoos-lite ${env} v0.0.7`)
        assert.match(run.log, new RegExp(`admitted from=192\\.0\\.2\\.7 app=nivoos-lite env=${env} tag=v0\\.0\\.7`))
    }
})

test("the gate refuses every other request with 126, without echoing it and without reaching root", { skip: !shAvailable }, () => {
    const refused: [string | undefined, string][] = [
        [undefined, "no command"],
        ["", "no command"],
        ["sh", "word count"],
        ["/bin/bash -i", "character outside the alphabet"],
        ["scp -t /root", "character outside the alphabet"],
        ["internal-sftp", "word count"],
        ["deploy nivoos-lite staging v0.0.7; id", "character outside the alphabet"],
        ["deploy nivoos-lite staging $(id)", "character outside the alphabet"],
        ["deploy nivoos-lite staging v0.0.7 extra", "word count"],
        ["rollback nivoos-lite staging v0.0.7", "verb"],
        ["deploy other-app staging v0.0.7", "app not listed"],
        ["deploy -nivoos staging v0.0.7", "app"],
        ["deploy nivoos-lite dev v0.0.7", "env"],
        ["deploy nivoos-lite production main", "tag"],
        ["deploy nivoos-lite production v0.0", "tag"],
        ["deploy nivoos-lite production v0.0.7-rc1", "tag"],
        ["deploy nivoos-lite production 0.0.7", "tag"],
        [`deploy nivoos-lite production v${"1".repeat(120)}`, "too long"],
    ]
    for (const [request, reason] of refused) {
        const run = gate(request)
        assert.equal(run.status, 126, `${JSON.stringify(request)}: ${run.stdout}`)
        assert.equal(run.stdout, "", `${JSON.stringify(request)} reached root`)
        assert.match(run.stderr, new RegExp(`refused \\(${reason.replace(/[()]/g, "\\$&")}\\)`), JSON.stringify(request))
        if (request) assert.ok(!run.stderr.includes(request), "the request is never echoed")
        assert.match(run.log, /refused from=192\.0\.2\.7 reason=/)
    }
})

test("the gate admits only the apps the server lists", { skip: !shAvailable }, () => {
    assert.equal(gate("deploy nivoos-lite staging v1.2.3", []).status, 126)
    assert.equal(gate("deploy starci-next staging v1.2.3", ["nivoos-lite", "starci-next"]).stdout, "RUN starci-next staging v1.2.3")
})

test("the runner and the installer are bash scripts that parse, and the workflow reaches the key only from a release tag push", () => {
    for (const file of ["starci-deploy-run", "install.sh"]) {
        const text = readFileSync(join(repo, "ops/vps/runner", file), "utf8")
        assert.ok(text.startsWith("#!/bin/bash\n"), file)
        assert.match(text, /set -euo pipefail/, file)
        if (shAvailable) assert.equal(spawnSync("bash", ["-n", join(repo, "ops/vps/runner", file)]).status, 0, file)
    }
    const workflow = readFileSync(join(repo, "ops/vps/runner/deploy-runner.yml"), "utf8")
    const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"))
    assert.match(on, /push:\s*\n\s*tags: \["v\*"\]/)
    for (const trigger of ["pull_request", "pull_request_target", "workflow_run", "workflow_dispatch", "schedule", "branches"]) assert.ok(!on.includes(trigger), trigger)
    assert.ok(!/SOPS_AGE_KEY|AGE-SECRET/.test(workflow), "no age key in the workflow")
    const run = readFileSync(join(repo, "ops/vps/runner/starci-deploy-run"), "utf8")
    assert.match(run, /SOPS_AGE_KEY_FILE=\/root\/\.config\/sops\/age\/keys\.txt/)
    assert.match(run, /flock -w 1800 9/, "one deploy at a time on the server")
})
