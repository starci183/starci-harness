import { Command } from "@nestjs/cqrs"
import { Effectful } from "@modules/platform/inbox"
import type { ExecuteParams } from "@modules/platform/cqrs"

/** A client command used by typed lint cases. */
@Effectful()
export class ClientEffectfulCommand extends Command<void> {
    constructor(readonly params: ExecuteParams<{ idempotencyKey: string }>) { super() }
}
