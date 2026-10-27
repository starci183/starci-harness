import { z } from "zod"
import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    kind: { kind: "string", summary: "service, image or spec", required: true, positional: true },
    arguments: { kind: "rest", summary: "the kind's arguments (service: <folder> <name>)" },
    inject: { kind: "list", summary: "a constructor binding as Decorator=module:Type or Class=module, once per binding" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    kind: z.enum(["service", "image", "spec"]),
} as const

/** `starci app new`: create a canonical service, unit spec or app image definition; @starci/hfs runs it in-process in the app. */
export const appNewVerb = defineVerb({
    path: ["app", "new"],
    summary: "create a canonical service, unit spec or app image definition",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-new@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "new", hfsArgv(FLAGS, flags, CHOICES), false),
})
