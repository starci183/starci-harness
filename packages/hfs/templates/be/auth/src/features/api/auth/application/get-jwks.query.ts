// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Query } from "@nestjs/cqrs"
import type { JwksDocument } from "@modules/integrations/passport"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { EmptyRequest } from "./auth.contracts"

/** Reads the public key document access tokens verify against. */
export class GetJwksQuery extends Query<JwksDocument> {
    constructor(readonly params: PublicExecuteParams<EmptyRequest>) {
        super()
    }
}
