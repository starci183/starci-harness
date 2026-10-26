import type { ClientEffectfulInput } from "./dto/client-effectful.input"

/** Preserves the validated original key through the transport's pure request mapper. */
export const toClientEffectfulRequest = (input: ClientEffectfulInput): { idempotencyKey: string } => ({ idempotencyKey: input.idempotencyKey })
