import { z } from "zod"
import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    noun: { kind: "string", summary: "the capability: api, webhook, realtime, saga, job, reactor, queue, projection, cli, table or app", required: true, positional: true },
    name: { kind: "string", summary: "the capability's name", required: true, positional: true },
    event: { kind: "string", summary: "event consumed by a reactor" },
    from: { kind: "string", summary: "source service of an event" },
    service: { kind: "string", summary: "service binding as Class=module" },
    connection: { kind: "string", summary: "declared connection used by a projection" },
    owner: { kind: "string", summary: "service that owns a saga" },
    failed: { kind: "string", summary: "failure event consumed by a saga" },
    done: { kind: "string", summary: "completion event consumed by a saga" },
    fe: { kind: "boolean", summary: "add the typed front-end database modules of a lite table" },
    "no-types": { kind: "boolean", summary: "skip regenerating the Supabase database types after lite table and queue migrations" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    noun: z.enum(["api", "webhook", "realtime", "saga", "job", "reactor", "queue", "projection", "cli", "table", "app"]),
} as const

/** `starci app add`: add one canonical back-end capability and register its patterns; @starci/hfs runs it in-process in the app. */
export const appAddVerb = defineVerb({
    path: ["app", "add"],
    summary: "add one canonical back-end capability and register its patterns",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-add@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "add", hfsArgv(FLAGS, flags, CHOICES), false),
})
