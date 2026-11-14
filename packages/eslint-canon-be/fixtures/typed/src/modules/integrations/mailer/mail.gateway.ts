/** Fixture: an outbound mail provider. */
export declare class MailGateway {
    send(to: string): Promise<void>
    status(id: string): Promise<string>
}
