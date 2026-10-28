/** The process entry of the gateway and its key commands: `node <package>/dist/gateway/run.js <command>`; it stops on SIGINT and SIGTERM. */
import { main } from "./cli.ts"

const stop = new AbortController()
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
        stop.abort()
    })
}

process.exitCode = await main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    env: process.env,
    signal: stop.signal,
})
