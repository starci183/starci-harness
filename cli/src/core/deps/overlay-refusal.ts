import { rmSync } from "node:fs"
import { overlayRecordPath } from "../../harness/ledger.js"
import { Refusal } from "../../shared/errors.js"

/** The one refusal of a project that still records the removed package overlay. */
export const OVERLAY_REMOVED = "DEPS_OVERLAY_REMOVED"

/**
 * Refuses DEPS_OVERLAY_REMOVED when the project's state folder still holds the record of the removed package overlay (packages
 * copied into `node_modules`): the app's installs hold copies no lockfile names. The one way to use an unreleased package edit
 * is the local registry, and `starci deps install-local --restore` clears the record and returns the app to its lockfile.
 */
export const refuseRecordedOverlay = (root: string): void => {
    if (overlayRecordPath(root) === undefined) return
    throw new Refusal(
        OVERLAY_REMOVED,
        `this project still records a local package overlay (packages copied into node_modules), which no longer exists. Run starci deps install-local --restore to clear it and return the app to its lockfile; to use an unreleased package edit, run starci deps publish-local --execute in the harness checkout, then starci deps install-local <package> --execute in the app`,
    )
}

/** Deletes the removed overlay's record from the project's state folder; true when one was there. */
export const clearOverlayRecord = (root: string): boolean => {
    const file = overlayRecordPath(root)
    if (file === undefined) return false
    rmSync(file, { force: true })
    return true
}
