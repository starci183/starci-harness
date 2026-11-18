import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app desktop`: the desktop app of a project that declares `sides.desktop`, a Tauri shell around its deployed web app (init, doctor, build, dev, keygen); @starci/hfs runs it in-process in the app. The checks never need Rust; only build, dev and keygen do, and CI builds the release installers. */
export const appDesktopVerb = defineVerb({
    path: ["app", "desktop"],
    summary: "declare, build and sign the desktop app of a project (init, doctor, build, dev, keygen); the release installers are built in CI",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-desktop@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "desktop", flags.args, false),
})
