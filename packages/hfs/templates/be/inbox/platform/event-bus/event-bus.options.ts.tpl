/** How the consumers of the app read their queues; every field has a default, so a bare registration works. */
export interface EventBusOptions {
    /** Seconds a read message stays hidden: a consumer that fails or dies lets it reappear after this. Default 30. */
    readonly visibilitySeconds?: number
    /** The most messages one read takes from a queue. Default 10. */
    readonly batch?: number
    /** The pause between two reads of an empty queue, in milliseconds. Default 500. */
    readonly idleMs?: number
}
