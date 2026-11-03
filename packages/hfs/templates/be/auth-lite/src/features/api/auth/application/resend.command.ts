// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Command } from "@nestjs/cqrs"
import type { PublicExecuteParams } from "@modules/platform/cqrs"
import type { AddressData } from "./auth.contracts"

/** Mails a new confirmation link to an unconfirmed account; the answer never says whether the address has one. */
export class ResendCommand extends Command<void> {
    constructor(readonly params: PublicExecuteParams<AddressData>) {
        super()
    }
}
