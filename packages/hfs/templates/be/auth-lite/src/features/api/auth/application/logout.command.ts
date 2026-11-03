// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { ExchangeRequest } from "./auth.contracts"

/** Ends the session of the refresh cookie and clears it. */
export class LogoutCommand extends Command<void> {
    constructor(readonly params: PublicExecuteParams<ExchangeRequest>) {
        super()
    }
}
