import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString, MaxLength } from "class-validator"

/** The @@actionCamel@@ body: the id of the subject. */
export class @@Action@@Request {
    /** The id of the subject. */
    @ApiProperty({ maxLength: 64 })
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    readonly id!: string
}
