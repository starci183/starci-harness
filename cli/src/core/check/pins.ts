import { captureNpm } from "../../shared/exec.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { listPackages } from "../../shared/workspace.js"
import { STACK_PINS, cliPinSkews, describeSkews } from "./cli-pins.js"
import type { PinSkew } from "./cli-pins.js"

/**
 * Whether a skew only waits on npm: its pin names the version this repository's package folder holds, and npm answers that
 * version with a 404, so the publication of this commit (`publish-packages`) is what brings it. The CLI cannot require a version
 * npm does not serve, so between the two phases of a release its requirement trails the pin by design; `release publish` still
 * holds the CLI on the skew (assertCliPins). A registry that cannot be asked is not a 404: the skew stays red.
 */
const awaitsPublication = async (skew: PinSkew, due: ReadonlyMap<string, string>, root: string): Promise<boolean> => {
    if (skew.expected === undefined || due.get(skew.package) !== skew.expected) return false
    const view = await captureNpm(["view", `${skew.package}@${skew.expected}`, "version"], root)
    return view.exitCode !== 0 && /\bE404\b|404 Not Found/u.test(`${view.stdout}${view.stderr}`)
}

/**
 * `starci check pins`: the CLI's @starci requirements and locked installs agree with contexts/stack/pins.yaml; red names each skew.
 * A skew whose pinned version is this commit's own unpublished package version is pending, not red: the CLI follows once npm serves it.
 */
export const checkPinsVerb = defineVerb({
    path: ["check", "pins"],
    summary: `judge the CLI's own @starci packages against ${STACK_PINS}: every requirement of cli/package.json and every copy cli/package-lock.json resolves is at its pin; red names each CLI_PIN_SKEW with the package, where, the pin and the version found; pending (exit 0) when every skew pins a version of this repository that npm does not serve yet, which the commit's publication brings`,
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-pins@1",
    flags: {},
    run: async (context) => {
        const root = await repositoryRoot(context.cwd)
        const skews = cliPinSkews(root)
        if (skews.length === 0) {
            return { data: { skews, pending: [], verdict: "green" }, message: [`the CLI takes every @starci package at its ${STACK_PINS} pin`, "verdict: green"].join("\n"), exitCode: 0 }
        }
        const due = new Map(listPackages(root).map((pkg) => [pkg.name, pkg.version]))
        const waiting = await Promise.all(skews.map((skew) => awaitsPublication(skew, due, root)))
        const pending = skews.filter((_, index) => waiting[index])
        const verdict = pending.length === skews.length ? "pending" : "red"
        const lines = verdict === "pending"
            ? [...describeSkews(skews).map((line) => `pending: ${line}`), `each pinned version is this commit's own package, not on npm yet: publish-packages brings it, then raise the CLI requirement and lockfile to the pin (npm install in cli/)`]
            : describeSkews(skews.filter((_, index) => !waiting[index]))
        return { data: { skews, pending, verdict }, message: [...lines, `verdict: ${verdict}`].join("\n"), exitCode: verdict === "red" ? 1 : 0 }
    },
})
