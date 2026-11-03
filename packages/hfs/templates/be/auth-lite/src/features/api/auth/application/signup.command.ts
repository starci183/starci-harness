// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { SignupData } from "./auth.contracts"

/** Creates an unconfirmed password account and mails the confirmation link; the answer never says whether the address already had an account. */
export class SignupCommand extends Command<void> {
    constructor(readonly params: PublicExecuteParams<SignupData>) {
        super()
    }
}
