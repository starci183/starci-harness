import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app audit`: the production dependency audit (`npm audit --json`) judged against the app's time-boxed exceptions; the managed CI step and the pre-push parity run it; @starci/hfs runs it in-process in the app. */
export const appAuditVerb = defineVerb({
    path: ["app", "audit"],
    summary: "run the production dependency audit and judge it against .starcistacks/security/audit-exceptions.yaml (time-boxed, owner-approved exceptions)",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: WRITERS,
    schema: "starci/app-audit@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "audit", flags.args, false),
})
