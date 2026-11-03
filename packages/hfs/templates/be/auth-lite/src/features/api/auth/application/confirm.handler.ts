// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentityEmailService } from "@modules/domain/identity"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { ConfirmCommand } from "./confirm.command"

@CommandHandler(ConfirmCommand)
/** Spends a confirmation link and confirms the mailbox. */
export class ConfirmHandler extends ICQRSHandler<ConfirmCommand, void> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly email: IdentityEmailService,
    ) {
        super(logger)
    }

    protected override process(command: ConfirmCommand): Promise<void> {
        return this.email.confirm(command.params.request.token)
    }
}
