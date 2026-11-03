// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentitySignInService } from "@modules/domain/identity"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { GoogleBeginCommand } from "./google-begin.command"

@CommandHandler(GoogleBeginCommand)
/** Starts the Google round trip: the strategy writes the redirect and the signed state cookie. */
export class GoogleBeginHandler extends ICQRSHandler<GoogleBeginCommand, void> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly signIn: IdentitySignInService,
    ) {
        super(logger)
    }

    protected override process(command: GoogleBeginCommand): Promise<void> {
        return this.signIn.beginGoogle(command.params.request.exchange)
    }
}
