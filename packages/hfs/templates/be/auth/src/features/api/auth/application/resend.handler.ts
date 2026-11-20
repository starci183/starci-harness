// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentityEmailService } from "@modules/domain/identity"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { ResendCommand } from "./resend.command"

@CommandHandler(ResendCommand)
/** Mails a new confirmation link to an unconfirmed account; the answer never says whether the address has one. */
export class ResendHandler extends ICQRSHandler<ResendCommand, void> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly email: IdentityEmailService,
    ) {
        super(logger)
    }

    protected override process(command: ResendCommand): Promise<void> {
        return this.email.resend(command.params.request.email, command.params.request.language)
    }
}
