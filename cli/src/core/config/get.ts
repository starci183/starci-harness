import { getSetting } from "../../harness/settings.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** `starci config get <key>`: one harness setting's value and the ops/ file that owns it. */
export const configGetVerb = defineVerb({
    path: ["config", "get"],
    summary: "print one harness setting by its dotted key (e.g. routing.pools.claude.maxParallel) and the file that owns it",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/config-get@1",
    flags: { key: { kind: "string", summary: "the dotted key, as config list prints it", required: true, positional: true } },
    run: (_context, flags) => {
        const setting = getSetting(flags.key)
        return Promise.resolve({ data: setting, message: `${setting.key} = ${JSON.stringify(setting.value)} (${setting.file})` })
    },
})
