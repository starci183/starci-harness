// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { CommandHandler } from "@nestjs/cqrs"
import { IdentitySignInService } from "@modules/domain/identity"
import type { AccessGrant } from "@modules/integrations/passport"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { RefreshCommand } from "./refresh.command"

@CommandHandler(RefreshCommand)
/** Rotates the refresh cookie and answers a new access token; a bad cookie is cleared. */
export class RefreshHandler extends ICQRSHandler<RefreshCommand, AccessGrant> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly signIn: IdentitySignInService,
    ) {
        super(logger)
    }

    protected override process(command: RefreshCommand): Promise<AccessGrant> {
        return this.signIn.refresh(command.params.request.exchange)
    }
}
