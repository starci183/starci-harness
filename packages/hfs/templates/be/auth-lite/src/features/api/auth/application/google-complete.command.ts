// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { GoogleRedirect } from "@modules/integrations/passport"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { ExchangeRequest } from "./auth.contracts"

/** Finishes the Google round trip. */
export class GoogleCompleteCommand extends Command<GoogleRedirect> {
    constructor(readonly params: PublicExecuteParams<ExchangeRequest>) {
        super()
    }
}
