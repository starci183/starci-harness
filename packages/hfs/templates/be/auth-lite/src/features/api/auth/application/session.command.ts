// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { AccessGrant } from "@modules/integrations/passport"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { ExchangeRequest } from "./auth.contracts"

/** Answers a fresh access token for the cookie session without rotating the cookie. */
export class SessionCommand extends Command<AccessGrant> {
    constructor(readonly params: PublicExecuteParams<ExchangeRequest>) {
        super()
    }
}
