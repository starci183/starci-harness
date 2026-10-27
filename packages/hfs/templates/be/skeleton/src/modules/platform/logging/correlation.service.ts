import { InjectIds } from "@modules/platform/ids"
import type { Ids } from "@modules/platform/ids"
import type { CorrelationHeaders, CorrelationWork } from "./correlation.contracts"
import { correlationFromHeaders, runWithCorrelation } from "./correlation.policy"
import type { CorrelationIds, CorrelationRunner } from "./correlation.port"

/** Owns inbound identity resolution and logging scopes; business code receives explicit identities. */
export class CorrelationService implements CorrelationIds, CorrelationRunner {
    constructor(@InjectIds() private readonly ids: Ids) {}

    /** Chooses an inbound identity, minting through Ids when both headers are absent or invalid. */
    fromHeaders(headers: CorrelationHeaders): string {
        return correlationFromHeaders(headers, this.ids)
    }

    /** Starts work that has no inbound identity through the deterministic Ids port. */
    create(): string {
        return this.ids.next()
    }

    /** Applies only to logging; callers still pass the identity to outgoing envelopes explicitly. */
    run<T>(correlationId: string, work: CorrelationWork<T>): T {
        return runWithCorrelation(correlationId, work)
    }
}

/** Builds an infrastructure logging runner for bootstrap and test worlds without a Nest container. */
export const createCorrelationRunner = (ids: Ids): CorrelationRunner => new CorrelationService(ids)
