// The bench's Docker stand-in. It is preloaded (NODE_OPTIONS --import) into every node process of a bench run and acts only in
// a copy of node named docker(.exe), which the runner points STARCI_DOCKER_BIN at; anywhere else it returns at once. It answers
// the docker calls `starci uat run` makes (harness/uat.ts): `info` names a Linux engine, `image inspect` finds every image (so no
// image is built), and `run` plays the container on this host: the CLI's built relay (STARCI_BENCH_DOCKER_PREAMBLE) runs under the
// bench's own node (STARCI_BENCH_NODE) with the script's and the evidence folder's host paths in place of their mounts, relaying
// each forwarded port on 127.0.0.1 to the same port on STARCI_BENCH_DOCKER_UPSTREAM (default 127.0.0.2, where a bench app
// stand-in listens), with its output and exit code passed through. `rm` and `container inspect` find no container, as after a
// `--rm` run. No real Docker is ever run.
import { spawnSync } from "node:child_process"
import { basename, join } from "node:path"

const self = basename(process.execPath).toLowerCase()

/** The options of `docker run` the harness passes that take a value; every other `--` option is a flag. */
const VALUED = new Set(["--name", "--label", "--shm-size", "--memory", "--add-host", "--user", "--env", "--mount"])

const done = (code, out = "", err = "") => {
    if (out !== "") process.stdout.write(out)
    if (err !== "") process.stderr.write(err)
    process.exit(code)
}

/** Plays one `docker run`: the relay and the script on this host, mounts mapped to their sources. */
const run = (args) => {
    const mounts = new Map()
    const env = {}
    let index = 0
    for (; index < args.length; index += 1) {
        const arg = args[index]
        if (!arg.startsWith("--")) break
        if (!VALUED.has(arg)) continue
        const value = args[index + 1] ?? ""
        index += 1
        if (arg === "--mount") {
            const fields = Object.fromEntries(value.split(",").map((field) => field.split("=")))
            mounts.set(fields.dst, fields.src)
        } else if (arg === "--env") {
            const equals = value.indexOf("=")
            if (equals > 0) env[value.slice(0, equals)] = value.slice(equals + 1)
        }
    }
    const scriptArgs = args.slice(index + 1)
    const host = (path) => {
        for (const [dst, src] of mounts) if (path === dst || path.startsWith(`${dst}/`)) return join(src, path.slice(dst.length))
        return path
    }
    const evidence = host(env.STARCI_UAT_EVIDENCE ?? "/evidence")
    const child = spawnSync(process.env.STARCI_BENCH_NODE ?? "node", [process.env.STARCI_BENCH_DOCKER_PREAMBLE ?? "", ...scriptArgs], {
        cwd: evidence,
        stdio: "inherit",
        env: {
            ...process.env,
            ...env,
            HOME: process.env.HOME ?? "",
            STARCI_UAT_SCRIPT: host(env.STARCI_UAT_SCRIPT ?? ""),
            STARCI_UAT_EVIDENCE: evidence,
            STARCI_UAT_UPSTREAM: process.env.STARCI_BENCH_DOCKER_UPSTREAM ?? "127.0.0.2",
        },
    })
    done(child.status ?? 1)
}

if (self === "docker" || self === "docker.exe") {
    // Node reads the first argument as its main script and hands it over resolved to a path; its base name is the command.
    const [command, ...rest] = process.argv.slice(1).map((arg, index) => (index === 0 ? basename(arg) : arg))
    if (command === "info") done(0, "linux bench-stub\n")
    if (command === "image" && rest[0] === "inspect") done(0, "sha256:bench\n")
    if (command === "run") run(rest)
    if (command === "rm" || command === "container") done(1, "", "Error: No such container\n")
    done(1, "", `docker stand-in: ${String(command)} is not a call the harness makes\n`)
}
