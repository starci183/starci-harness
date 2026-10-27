import { z } from "zod"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { EDITION, EDITION_FLAG, hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    name: { kind: "string", summary: "the app's name", required: true, positional: true },
    into: { kind: "string", summary: "parent directory in which the named app is created" },
    "registry-visibility": { kind: "string", summary: "public or private: visibility of the app's container images written once into deploy.registry (default public; the app owns it afterwards)" },
    ...EDITION_FLAG,
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    "registry-visibility": z.enum(["public", "private"]),
    edition: EDITION,
} as const

/** `starci app scaffold`: create a full or lite StarCi app in its own Git repository (unborn main); @starci/hfs runs it in-process in the app. */
export const appScaffoldVerb = defineVerb({
    path: ["app", "scaffold"],
    summary: "create a full or lite StarCi app in its own Git repository (unborn main)",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/app-scaffold@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "scaffold", hfsArgv(FLAGS, flags, CHOICES), false),
})
