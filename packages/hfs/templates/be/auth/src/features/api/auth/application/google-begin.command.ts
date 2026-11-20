// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { ExchangeRequest } from "./auth.contracts"

/** Starts the Google round trip: the strategy writes the redirect and the signed state cookie. */
export class GoogleBeginCommand extends Command<void> {
    constructor(readonly params: PublicExecuteParams<ExchangeRequest>) {
        super()
    }
}
