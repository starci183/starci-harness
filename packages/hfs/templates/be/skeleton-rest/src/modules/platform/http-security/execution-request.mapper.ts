import type { ExecutionContext } from "@nestjs/common"
import type { Request } from "express"

/** The HTTP request behind an execution context: a rest back end's doors are controllers, so every context is an HTTP one. */
export const requestOf = (context: ExecutionContext): Request => context.switchToHttp().getRequest<Request>()
