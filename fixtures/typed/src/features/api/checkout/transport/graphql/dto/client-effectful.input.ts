import { IsUUID } from "class-validator"

/** The wire key whose validation an effectful command depends on. */
export class ClientEffectfulInput {
    @IsUUID()
    idempotencyKey!: string
}
