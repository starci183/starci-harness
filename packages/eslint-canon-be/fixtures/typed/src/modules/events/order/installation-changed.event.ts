import { BaseEvent } from "@modules/platform/event-bus"

/** An installation changed: an event name with an underscore, whose file stem is kebab case. */
export class InstallationChangedEvent extends BaseEvent {
    static readonly eventName = "installation_changed"
    static readonly version = 1
    constructor(readonly eventId: string, readonly installationId: string) {
        super()
    }

    /** Reads a stored payload back. */
    static parse(value: unknown): InstallationChangedEvent | null {
        const record = value as { eventId?: string; installationId?: string } | null
        return record?.eventId && record.installationId ? new InstallationChangedEvent(record.eventId, record.installationId) : null
    }
}
