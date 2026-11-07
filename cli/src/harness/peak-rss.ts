// peak-rss.ts - the measured RAM peak of a heavy command's process tree, for the steps table of `starci app check`. A preload that NODE_OPTIONS carries to
// every node process of the tree (npm, next build, a jest worker forked with the parent's options) writes its own peak resident set (`resourceUsage().maxRSS`,
// the peak working set on Windows) to a folder of the command when it exits; the peak of the command is then its largest process, and for a test run the
// parent and its workers at the largest worker's peak each. A process killed before it exits writes nothing, so a killed command is unmeasured.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The environment variable naming the folder every process of the command writes its peak to. */
const PEAK_DIR_ENV = "STARCI_PEAK_DIR"

const PRELOAD_FILE = "starci-peak-rss-1.cjs"
const PRELOAD_SOURCE = `const fs = require("node:fs")
const path = require("node:path")
const dir = process.env.STARCI_PEAK_DIR
if (dir) process.on("exit", () => {
  try { fs.writeFileSync(path.join(dir, process.pid + ".json"), JSON.stringify({ kb: process.resourceUsage().maxRSS, worker: Boolean(process.env.JEST_WORKER_ID) })) } catch {}
})
`

/** Writes the preload once and returns its path, slash-separated so NODE_OPTIONS takes it on any host. */
const preload = (): string => {
    const file = join(tmpdir(), PRELOAD_FILE)
    if (!existsSync(file) || readFileSync(file, "utf8") !== PRELOAD_SOURCE) writeFileSync(file, PRELOAD_SOURCE)
    return file.replaceAll("\\", "/")
}

/** One command's probe: the environment its tree runs under, and its peak once it ended. */
export interface PeakProbe {
    /** `inherited` NODE_OPTIONS with the preload, and the folder the tree writes to. */
    readonly env: (inherited: string) => Readonly<Record<string, string>>
    /** The command's peak in MB, `workers` its test run's workers when it was one; undefined when no process wrote one. Removes the folder. */
    readonly peakMb: (workers?: number) => number | undefined
}

/** A probe for one command. */
export const peakProbe = (): PeakProbe => {
    const dir = mkdtempSync(join(tmpdir(), "starci-peak-"))
    return {
        env: (inherited) => ({ NODE_OPTIONS: `${inherited} --require=${preload()}`.trim(), [PEAK_DIR_ENV]: dir }),
        peakMb: (workers) => {
            const peaks: { readonly mb: number; readonly worker: boolean }[] = []
            try {
                for (const name of readdirSync(dir)) {
                    const read = JSON.parse(readFileSync(join(dir, name), "utf8")) as { readonly kb?: unknown; readonly worker?: unknown }
                    if (typeof read.kb === "number") peaks.push({ mb: read.kb / 1024, worker: read.worker === true })
                }
            } catch {
                // An unreadable folder or file leaves the command unmeasured.
            } finally {
                rmSync(dir, { recursive: true, force: true })
            }
            if (peaks.length === 0) return undefined
            const largest = (list: readonly { readonly mb: number }[]): number => list.reduce((best, peak) => Math.max(best, peak.mb), 0)
            const workerPeaks = peaks.filter((peak) => peak.worker)
            const total = workers === undefined || workerPeaks.length === 0 ? largest(peaks) : largest(peaks.filter((peak) => !peak.worker)) + workers * largest(workerPeaks)
            return Math.round(total)
        },
    }
}
