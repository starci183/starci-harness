/** Fixture: even the webhook feature's own command handler is reached only by its later consumer. */
export class RecordAcmePayHandler {
    async handle(): Promise<void> {}
}
