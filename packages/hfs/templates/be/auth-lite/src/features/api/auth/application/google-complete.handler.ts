// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentitySignInService } from "@modules/domain/identity"
import type { GoogleRedirect } from "@modules/integrations/passport"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { GoogleCompleteCommand } from "./google-complete.command"

@CommandHandler(GoogleCompleteCommand)
/** Finishes the Google round trip. */
export class GoogleCompleteHandler extends ICQRSHandler<GoogleCompleteCommand, GoogleRedirect> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly signIn: IdentitySignInService,
    ) {
        super(logger)
    }

    protected override process(command: GoogleCompleteCommand): Promise<GoogleRedirect> {
        return this.signIn.completeGoogle(command.params.request.exchange)
    }
}
