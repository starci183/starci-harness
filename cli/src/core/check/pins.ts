import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { STACK_PINS, cliPinSkews, describeSkews } from "./cli-pins.js"

/** `starci check pins`: the CLI's @starci requirements and locked installs agree with contexts/stack/pins.yaml; red names each skew. */
export const checkPinsVerb = defineVerb({
    path: ["check", "pins"],
    summary: `judge the CLI's own @starci packages against ${STACK_PINS}: every requirement of cli/package.json and every copy cli/package-lock.json resolves is at its pin; red names each CLI_PIN_SKEW with the package, where, the pin and the version found`,
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-pins@1",
    flags: {},
    run: async (context) => {
        const skews = cliPinSkews(await repositoryRoot(context.cwd))
        const verdict = skews.length === 0 ? "green" : "red"
        const lines = skews.length === 0 ? [`the CLI takes every @starci package at its ${STACK_PINS} pin`] : describeSkews(skews)
        return { data: { skews, verdict }, message: [...lines, `verdict: ${verdict}`].join("\n"), exitCode: verdict === "red" ? 1 : 0 }
    },
})
