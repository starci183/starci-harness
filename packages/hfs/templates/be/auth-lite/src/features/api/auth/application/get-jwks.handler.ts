// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { QueryHandler } from "@nestjs/cqrs"
import { IdentitySignInService } from "@modules/domain/identity"
import type { JwksDocument } from "@modules/integrations/passport"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { GetJwksQuery } from "./get-jwks.query"

@QueryHandler(GetJwksQuery)
/** Answers the JWKS. */
export class GetJwksHandler extends ICQRSHandler<GetJwksQuery, JwksDocument> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly signIn: IdentitySignInService,
    ) {
        super(logger)
    }

    protected override process(): Promise<JwksDocument> {
        return this.signIn.jwks()
    }
}
