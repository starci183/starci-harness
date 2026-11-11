import { ApiProperty } from "@nestjs/swagger"

/** The one error body every operation answers as `default`: its machine code and its message. */
export class ErrorResponse {
    /** The machine code of the failure, stable across releases. */
    @ApiProperty() readonly code!: string
    /** The failure in words, from the messages catalog. */
    @ApiProperty() readonly message!: string
}

/** The @@actionCamel@@ answer. */
export class @@Action@@Response {
    /** The id of the subject. */
    @ApiProperty() readonly id!: string
}
