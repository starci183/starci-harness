import { defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci audit run <area>/<screen>`: prepare the next UI audit round of a gallery screen and print the auditor brief; the harness never calls a model, the auditor agent (not the builder) fills the rounds in screen.yaml; @starci/hfs runs it in the app. */
export const auditRunVerb = defineVerb({
    path: ["audit", "run"],
    summary: "prepare the next UI audit round of a gallery screen (PROJECT-GALLERY-8): record the shot sha256 of 1440.png and 390.png, write the next round as seven open lenses into gallery/pages/<area>/<screen>/screen.yaml and print the brief (shots at full size, the seven lenses, the laws) that an auditor agent other than the builder reads and fills; --builder and --auditor name the agents, --out writes the brief to a file",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/audit-run@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "uiaudit", ["run", ...flags.args], false),
})

/** `starci audit cycle <area>/<screen> --reason <why>`: close the screen's audit cycle into `considered` and open a new one; the way back to a screen after its round 4. */
export const auditCycleVerb = defineVerb({
    path: ["audit", "cycle"],
    summary: "close a gallery screen's UI audit cycle into its screen.yaml `considered` (the reason, the rounds and their dates, the last verdict of each lens, builder and auditor; the rounds stay in git history) and start an empty audit, so the next `starci audit run` prepares round 1 of a new cycle; the lawful way back to a screen after its round 4 (audit rounds are evidence, never a gate)",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/audit-cycle@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "uiaudit", ["cycle", ...flags.args], false),
})

/** `starci audit status`: every gallery screen with its UI audit state. */
export const auditStatusVerb = defineVerb({
    path: ["audit", "status"],
    summary: "list the gallery screens whose UI audit is pending, open, stale or past its round 4, with the count of audited and not yet audited screens (--json for machines); evidence for the builder, never a gate",
    effect: "read",
    roles: WRITERS,
    schema: "starci/audit-status@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "uiaudit", ["status", ...flags.args], true),
})

/** `starci gallery migrate-explain`: turn every explain.md into a screen.yaml. */
export const galleryMigrateVerb = defineVerb({
    path: ["gallery", "migrate-explain"],
    summary: "turn every gallery explain.md into screen.yaml (regions become sections, the options section becomes considered, shot hashes are taken from the PNGs on disk, audit: null grandfathers the screen) and delete the explain.md; a dry run unless --execute",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/gallery-migrate-explain@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "gallery", ["migrate-explain", ...flags.args], false),
})
