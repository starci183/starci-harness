// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentityEmailService } from "@modules/domain/identity"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { ResetCommand } from "./reset.command"

@CommandHandler(ResetCommand)
/** Spends a reset link: sets the new password and ends every session of the person. */
export class ResetHandler extends ICQRSHandler<ResetCommand, void> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly email: IdentityEmailService,
    ) {
        super(logger)
    }

    protected override process(command: ResetCommand): Promise<void> {
        return this.email.reset(command.params.request.token, command.params.request.password)
    }
}
