import { SETTINGS_FILES, listSettings, settingsFileOf } from "../../harness/settings.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** `starci config list [--file <name>]`: every harness setting as a dotted key, its value and the ops/ file that owns it. */
export const configListVerb = defineVerb({
    path: ["config", "list"],
    summary: "list every harness setting (or one file's) as a dotted key with its value and the ops/ yaml that owns it",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/config-list@1",
    flags: { file: { kind: "string", summary: `only this settings file: ${SETTINGS_FILES.join(", ")}` } },
    run: (_context, flags) => {
        const settings = listSettings(flags.file === undefined ? SETTINGS_FILES : [settingsFileOf(flags.file)])
        return Promise.resolve({ data: { settings }, message: settings.map((setting) => `${setting.key} = ${JSON.stringify(setting.value)}`).join("\n") })
    },
})
