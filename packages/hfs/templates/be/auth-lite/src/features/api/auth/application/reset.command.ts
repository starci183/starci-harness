// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { ResetData } from "./auth.contracts"

/** Spends a reset link: sets the new password and ends every session of the person. */
export class ResetCommand extends Command<void> {
    constructor(readonly params: PublicExecuteParams<ResetData>) {
        super()
    }
}
