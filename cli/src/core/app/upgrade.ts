import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { EDITION, EDITION_FLAG, hfsArgv, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
    plan: { kind: "boolean", summary: "preview the upgrade without writing" },
    ...EDITION_FLAG,
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    edition: EDITION,
} as const

/** `starci app upgrade`: add the test world a full app lacks; a lite app is refused because editions are fixed at scaffold; @starci/hfs runs it in-process in the app. */
export const appUpgradeVerb = defineVerb({
    path: ["app", "upgrade"],
    summary: "add the test world a full app lacks; a lite app is refused because editions are fixed at scaffold",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-upgrade@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "upgrade", hfsArgv(FLAGS, flags, CHOICES), false),
})
