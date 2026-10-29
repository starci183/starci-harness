import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

// The nouns are @starci/hfs's own (its addKinds); it refuses any other as HFS_ADD_NOUN_UNKNOWN, so the CLI keeps no copy of the list.
const FLAGS = {
    noun: { kind: "string", summary: "what to add: a back-end capability (api, webhook, realtime, saga, job, reactor, queue, projection, cli, table, app) or a front-end unit (block, composite, branch, leaf, page, overlay, layout)", required: true, positional: true },
    name: { kind: "string", summary: "its name; for a page or layout, its route under [locale] (settings/billing)", required: true, positional: true },
    event: { kind: "string", summary: "event consumed by a reactor" },
    from: { kind: "string", summary: "source service of an event" },
    service: { kind: "string", summary: "service binding as Class=module" },
    connection: { kind: "string", summary: "declared connection used by a projection" },
    owner: { kind: "string", summary: "service that owns a saga" },
    failed: { kind: "string", summary: "failure event consumed by a saga" },
    done: { kind: "string", summary: "completion event consumed by a saga" },
    fe: { kind: "boolean", summary: "add the typed front-end database modules of a lite table" },
    shapes: { kind: "string", summary: "a front-end unit: its drawn shapes, two or more as a,b,c (none when it has one)" },
    read: { kind: "string", summary: "a front-end unit: the API read its data slot takes" },
    app: { kind: "string", summary: "a front-end unit: the fe app it is added to" },
    kind: { kind: "string", summary: "an overlay: its shell, modal or drawer" },
    form: { kind: "boolean", summary: "an overlay: it holds a one-column form" },
    blocks: { kind: "string", summary: "a page or layout: the existing blocks it composes, as a,b" },
    tabs: { kind: "string", summary: "a page: its page tabs as link tabs, two or more ids as a,b (the first is the route, the rest its sub-routes)" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

/** `starci app add`: add one canonical back-end capability or front-end unit and register its patterns; @starci/hfs runs it in-process in the app. */
export const appAddVerb = defineVerb({
    path: ["app", "add"],
    summary: "add one canonical back-end capability or front-end unit and register its patterns",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-add@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "add", hfsArgv(FLAGS, flags), false),
})
