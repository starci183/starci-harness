// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { AddressData } from "./auth.contracts"

/** Mails a password reset link when the address has an account; the answer never says whether it does. */
export class ForgotCommand extends Command<void> {
    constructor(readonly params: PublicExecuteParams<AddressData>) {
        super()
    }
}
