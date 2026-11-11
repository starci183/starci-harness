import { Injectable } from "@nestjs/common"
import { InjectDatabaseProbe, type DatabaseProbeService } from "@modules/platform/database"
import { InjectTimer, type Timer } from "@modules/platform/retry"
import { HttpSecurityError, HttpSecurityErrorCode } from "./errors/http-security.error"
import type { ReadinessReport } from "./readiness.contracts"
import { InjectRequiredProbes } from "./required-probes.decorators"
import type { RequiredProbesService } from "./required-probes.service"

/** The cancel of a deadline that was never scheduled. */
const noCancel = (): void => undefined

const READINESS_TIMEOUT_MS = 1000

@Injectable()
/** Required-dependency readiness; liveness never calls these probes. */
export class ReadinessService {
    constructor(
        @InjectDatabaseProbe() private readonly database: DatabaseProbeService,
        @InjectTimer() private readonly timer: Timer,
        @InjectRequiredProbes() private readonly required: RequiredProbesService,
    ) {}

    /** Returns ready only when the primary database and every added required dependency answer within one second. */
    async probeRequired(): Promise<ReadinessReport> {
        let cancel: () => void = noCancel
        try {
            await Promise.race([
                Promise.all([this.database.probe(), ...this.required.list().map((dependency) => dependency.probe())]),
                new Promise<never>((_resolve, reject) => {
                    cancel = this.timer.schedule(
                        () =>
                            reject(
                                new HttpSecurityError({
                                    code: HttpSecurityErrorCode.RequiredDependencyUnavailable,
                                    cause: new Error("Required dependency readiness timed out"),
                                }),
                            ),
                        READINESS_TIMEOUT_MS,
                    )
                }),
            ])
        } catch (cause) {
            if (cause instanceof HttpSecurityError) throw cause
            throw new HttpSecurityError({ code: HttpSecurityErrorCode.RequiredDependencyUnavailable, cause })
        } finally {
            cancel()
        }
        return { ok: true }
    }
}
