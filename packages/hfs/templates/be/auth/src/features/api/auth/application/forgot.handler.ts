// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentityEmailService } from "@modules/domain/identity"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { ForgotCommand } from "./forgot.command"

@CommandHandler(ForgotCommand)
/** Mails a password reset link when the address has an account; the answer never says whether it does. */
export class ForgotHandler extends ICQRSHandler<ForgotCommand, void> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly email: IdentityEmailService,
    ) {
        super(logger)
    }

    protected override process(command: ForgotCommand): Promise<void> {
        return this.email.forgot(command.params.request.email, command.params.request.language)
    }
}
