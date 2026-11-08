// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentitySignInService } from "@modules/domain/identity"
import type { AccessGrant } from "@modules/integrations/passport"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { SessionCommand } from "./session.command"

@CommandHandler(SessionCommand)
/** Answers a fresh access token for the cookie session without rotating the cookie. */
export class SessionHandler extends ICQRSHandler<SessionCommand, AccessGrant> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly signIn: IdentitySignInService,
    ) {
        super(logger)
    }

    protected override process(command: SessionCommand): Promise<AccessGrant> {
        return this.signIn.session(command.params.request.exchange)
    }
}
