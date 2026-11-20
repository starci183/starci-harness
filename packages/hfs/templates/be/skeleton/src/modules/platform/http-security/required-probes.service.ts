import { Injectable } from "@nestjs/common"
import type { RequiredProbe } from "./readiness.contracts"

@Injectable()
/** The required dependencies readiness probes besides the primary database: each integration that is one (the object store) adds itself at boot. */
export class RequiredProbesService {
    readonly #probes: Array<RequiredProbe> = []

    /** Adds a required dependency; readiness waits for it from the next probe on. */
    add(probe: RequiredProbe): void {
        this.#probes.push(probe)
    }

    /** The required dependencies added so far, in the order they were added. */
    list(): ReadonlyArray<RequiredProbe> {
        return [...this.#probes]
    }
}
