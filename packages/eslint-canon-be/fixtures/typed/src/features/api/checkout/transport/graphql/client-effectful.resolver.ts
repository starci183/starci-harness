import { ClientEffectfulCommand } from "@features/api/checkout/application/client-effectful.command"
import { ClientEffectfulInput } from "./dto/client-effectful.input"

/** Connects the input key declaration to its marked command in typed rule cases. */
export function dispatch(input: ClientEffectfulInput): ClientEffectfulCommand {
    return new ClientEffectfulCommand({ principal: { id: "person" }, request: input })
}
