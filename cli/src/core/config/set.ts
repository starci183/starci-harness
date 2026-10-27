import { parseValue, setSetting } from "../../harness/settings.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci config set <key> <value>`: the one door that changes a harness setting. It writes the value into the ops/ yaml that
 * owns the key, keeping its comments and layout, after that file's own loaders accepted the whole new file.
 */
export const configSetVerb = defineVerb({
    path: ["config", "set"],
    summary: "change one harness setting in the ops/ yaml that owns it, comments kept; the whole file is validated first and a refused value leaves it untouched",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "debug"],
    schema: "starci/config-set@1",
    flags: {
        key: { kind: "string", summary: "the dotted key, as config list prints it", required: true, positional: true },
        value: { kind: "string", summary: "the new value: JSON when it parses (6, true, null, [\"a\"], \"6\" for a string), else the text", required: true, positional: true },
    },
    run: (_context, flags) => {
        const set = setSetting(flags.key, parseValue(flags.value))
        return Promise.resolve({ data: set, message: `${set.key}: ${JSON.stringify(set.previous)} -> ${JSON.stringify(set.value)} (${set.file})` })
    },
})
