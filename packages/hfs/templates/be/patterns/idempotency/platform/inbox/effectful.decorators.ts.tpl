import { SetMetadata } from "@nestjs/common"

/** Metadata of a client command whose effects require a durable operation key. */
const EFFECTFUL: unique symbol = Symbol("platform.inbox.effectful")

/** Marks an effectful client command for BE_MUTATION_IDEMPOTENT; transaction ownership remains in its domain service. */
export const Effectful = (): ClassDecorator => SetMetadata(EFFECTFUL, true)
