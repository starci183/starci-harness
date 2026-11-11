import { ApiProperty } from "@nestjs/swagger"

/** The one error body every operation answers as `default`: its machine code and its message. */
export class ErrorResponse {
    @ApiProperty() readonly code!: string
    @ApiProperty() readonly message!: string
}

/** The liveness report: the process answers, since when, and for how many seconds. */
export class LivenessResponse {
    @ApiProperty({ enum: ["ok"] }) readonly status!: "ok"
    @ApiProperty() readonly startedAt!: string
    @ApiProperty() readonly uptimeSeconds!: number
}

/** The readiness report: the required primary database answered in time. */
export class ReadinessResponse {
    @ApiProperty({ enum: [true] }) readonly ok!: true
}
