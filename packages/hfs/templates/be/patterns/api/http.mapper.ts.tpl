import type { @@Action@@Request as @@Action@@Params, @@Action@@Result } from "../../application/@@action@@.contracts"
import type { @@Action@@Request } from "./dto/@@action@@.request"
import type { @@Action@@Response } from "./dto/@@action@@.response"

/** Maps the REST body to the command request. */
export const to@@Action@@Params = (body: @@Action@@Request): @@Action@@Params => ({ id: body.id })

/** Maps the result to the REST answer. */
export const to@@Action@@Response = (result: @@Action@@Result): @@Action@@Response => ({ id: result.id })
