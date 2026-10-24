import { CommandHandler } from "@nestjs/cqrs"
import { ClientEffectfulService } from "@modules/domain/order/client-effectful.service"
import { ClientEffectfulCommand } from "./client-effectful.command"

/** A typed path from an effectful command into its actual domain implementation. */
@CommandHandler(ClientEffectfulCommand)
export class ClientEffectfulHandler {
    constructor(private readonly service: ClientEffectfulService) {}
    process(command: ClientEffectfulCommand): Promise<void> {
        return this.service.place({ personId: command.params.principal.id, ...command.params.request })
    }
}
