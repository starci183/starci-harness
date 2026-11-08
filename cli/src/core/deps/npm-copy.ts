import { z } from "zod"
import { Refusal } from "../../shared/errors.js"
import { captureNpm } from "../../shared/exec.js"
import { NPMJS_FLAGS } from "./local-refs.js"
import { SOURCE_FIELD } from "./pack-stamped.js"

/** What npm serves of one version: the integrity of its tarball and, when it was packed by this harness, the source digest its manifest carries. */
export interface NpmCopy {
    readonly integrity: string | undefined
    readonly source: string | undefined
}

const copySchema = z.union([z.string(), z.looseObject({ "dist.integrity": z.string().optional(), [SOURCE_FIELD]: z.string().optional() })])

/**
 * The copy npm serves of `name@version`, asked of the public registry whatever the caller's npm configuration says; undefined when
 * npm does not serve that version. DEPS_REGISTRY_UNREACHABLE when npm cannot say, since an unknown is never a no.
 */
export const npmCopy = async (cwd: string, name: string, version: string): Promise<NpmCopy | undefined> => {
    const run = await captureNpm(["view", `${name}@${version}`, "dist.integrity", SOURCE_FIELD, "--json", ...NPMJS_FLAGS], cwd)
    if (run.exitCode !== 0) {
        if (/E404|ETARGET|No match found/.test(`${run.stdout}\n${run.stderr}`)) return undefined
        throw new Refusal("DEPS_REGISTRY_UNREACHABLE", `npm view ${name}@${version} failed, so what npm serves of it is unknown: ${run.stderr.trim().split("\n").slice(-3).join(" ")}`)
    }
    let raw: unknown
    try {
        raw = JSON.parse(run.stdout)
    } catch {
        raw = undefined
    }
    const parsed = copySchema.safeParse(raw)
    if (!parsed.success) return undefined
    if (typeof parsed.data === "string") return { integrity: parsed.data, source: undefined }
    return { integrity: parsed.data["dist.integrity"], source: parsed.data[SOURCE_FIELD] }
}
