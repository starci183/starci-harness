import { spawn } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { Refusal } from "./errors.js"

/**
 * What the relay runs: it starts the real command detached with the log as its output, writes the child's pid into the file its spec names and exits, so
 * the child's parent is a process that is gone. A tree kill of the caller (closing a terminal tab, `taskkill /T` of a lane's agent) never reaches it;
 * `detached: true` alone does not break that chain on Windows. The same relay starts a dev stack's processes (@starci/hfs stack/local-run.mts RELAY).
 */
const RELAY = "const {spawn}=require('node:child_process'),fs=require('node:fs');const o=JSON.parse(process.env.STARCI_RELAY_SPEC);delete process.env.STARCI_RELAY_SPEC;" +
    "const c=spawn(o.command,o.args,{cwd:o.cwd,env:process.env,detached:true,stdio:['ignore','inherit','inherit'],windowsHide:true});" +
    "c.on('error',(e)=>{fs.writeFileSync(o.pidFile+'.err',String(e.message));process.exit(1)});" +
    "if(typeof c.pid==='number'){fs.writeFileSync(o.pidFile,String(c.pid));c.unref();setTimeout(()=>process.exit(0),200)}"

/** Starts `argv` outside the caller's process tree with its output appended to `log`; resolves its pid. */
export const startRelayed = async (argv: readonly string[], cwd: string, log: string, env: NodeJS.ProcessEnv = process.env): Promise<number> => {
    const [command, ...args] = argv
    if (command === undefined) throw new Refusal("CLI_USAGE", "an empty command cannot run")
    mkdirSync(dirname(log), { recursive: true })
    const pidFile = `${log}.relay-pid`
    rmSync(pidFile, { force: true })
    rmSync(`${pidFile}.err`, { force: true })
    const descriptor = openSync(log, "a")
    try {
        const relay = spawn(process.execPath, ["-e", RELAY], { cwd, detached: true, windowsHide: true, env: { ...env, STARCI_RELAY_SPEC: JSON.stringify({ command, args, cwd, pidFile }) }, stdio: ["ignore", descriptor, descriptor] })
        relay.unref()
    } finally {
        closeSync(descriptor)
    }
    for (let waited = 0; waited <= 10_000; waited += 50) {
        if (existsSync(pidFile)) {
            const pid = Number(readFileSync(pidFile, "utf8").trim())
            if (Number.isInteger(pid) && pid > 0) {
                rmSync(pidFile, { force: true })
                return pid
            }
        }
        if (existsSync(`${pidFile}.err`)) {
            const why = readFileSync(`${pidFile}.err`, "utf8")
            rmSync(`${pidFile}.err`, { force: true })
            throw new Refusal("RELAY_NOT_STARTED", `${command} did not start: ${why}`)
        }
        await sleep(50)
    }
    throw new Refusal("RELAY_NOT_STARTED", `${command} did not start within 10 s (the relay wrote no pid; see ${log})`)
}
