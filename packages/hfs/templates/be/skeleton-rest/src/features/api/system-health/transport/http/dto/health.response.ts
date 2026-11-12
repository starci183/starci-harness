import { ApiProperty } from "@nestjs/swagger"

/** The one error body every operation answers as `default`: its machine code and its message. */
export class ErrorResponse {
    /** The machine code of the failure, stable across releases. */
    @ApiProperty() readonly code!: string
    /** The failure in words, from the messages catalog. */
    @ApiProperty() readonly message!: string
}

/** The liveness report: the process answers, since when, and for how many seconds. */
export class LivenessResponse {
    /** Always ok: the probe answers only while the process does. */
    @ApiProperty({ enum: ["ok"] }) readonly status!: "ok"
    /** When this process started, as an ISO 8601 instant. */
    @ApiProperty() readonly startedAt!: string
    /** Whole seconds the process has been up. */
    @ApiProperty() readonly uptimeSeconds!: number
}

/** The readiness report: the required primary database answered in time. */
export class ReadinessResponse {
    /** Whether this process can serve requests requiring the database. */
    @ApiProperty({ enum: [true] }) readonly ok!: true
}
