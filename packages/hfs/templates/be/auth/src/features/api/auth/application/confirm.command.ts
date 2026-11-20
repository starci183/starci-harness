// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { TokenData } from "./auth.contracts"

/** Spends a confirmation link and confirms the mailbox. */
export class ConfirmCommand extends Command<void> {
    constructor(readonly params: PublicExecuteParams<TokenData>) {
        super()
    }
}
