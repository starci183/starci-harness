// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentityEmailService } from "@modules/domain/identity"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { SignupCommand } from "./signup.command"

@CommandHandler(SignupCommand)
/** Creates an unconfirmed password account and mails the confirmation link; the answer never says whether the address already had an account. */
export class SignupHandler extends ICQRSHandler<SignupCommand, void> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly email: IdentityEmailService,
    ) {
        super(logger)
    }

    protected override process(command: SignupCommand): Promise<void> {
        return this.email.signup(
            command.params.request.email,
            command.params.request.password,
            command.params.request.language,
            command.params.request.name,
        )
    }
}
