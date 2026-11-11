import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common"
import type { CommandBus } from "@nestjs/cqrs"
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation } from "@nestjs/swagger"
import { CurrentPrincipal } from "@modules/domain/identity"
import { InjectCommandBus, type Principal } from "@modules/platform/cqrs"
import { @@Action@@Command } from "../../application/@@action@@.command"
import { to@@Action@@Params, to@@Action@@Response } from "./@@action@@.mapper"
import { @@Action@@Request } from "./dto/@@action@@.request"
import { ErrorResponse, @@Action@@Response } from "./dto/@@action@@.response"

@Controller("@@feature@@")
@ApiBearerAuth()
@ApiDefaultResponse({ type: ErrorResponse })
/** REST door of @@actionCamel@@: an authenticated caller's bearer access token, the operation `@@featureCamel@@.@@actionCamel@@`. */
export class @@Action@@Controller {
    constructor(@InjectCommandBus() private readonly commandBus: CommandBus) {}

    /** Runs @@action@@ for the caller. */
    @Post("@@action@@")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ operationId: "@@featureCamel@@.@@actionCamel@@" })
    @ApiOkResponse({ type: @@Action@@Response })
    async @@actionCamel@@(
        @CurrentPrincipal() principal: Principal,
        @Body() body: @@Action@@Request,
    ): Promise<@@Action@@Response> {
        const result = await this.commandBus.execute(
            new @@Action@@Command({ request: to@@Action@@Params(body), principal }),
        )
        return to@@Action@@Response(result)
    }
}
