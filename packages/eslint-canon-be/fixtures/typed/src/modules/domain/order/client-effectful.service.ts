import type { EntityManager } from "typeorm"
import type { Inbox } from "@modules/platform/inbox"

/** The real domain target of the fixture command handler. */
export class ClientEffectfulService {
    constructor(private readonly manager: EntityManager, private readonly inbox: Inbox) {}
    place(params: { personId: string; idempotencyKey: string }): Promise<void> {
        return this.manager.transaction((tx) => this.inbox.runClient({
            principalId: params.personId,
            operation: "checkout.place",
            idempotencyKey: params.idempotencyKey,
            request: {},
        }, tx, async () => {}))
    }
}
