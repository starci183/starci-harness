import type { OutsideReads } from "@modules/platform/effects"

/** Fixture: a mail box port that declares its reads; `send` is not declared, so it is an act. */
export interface MailBox extends OutsideReads<"status" | "list"> {
    status(id: string): Promise<string>
    list(): Promise<ReadonlyArray<string>>
    send(to: string): Promise<void>
}

/** Fixture: a client class that implements a port contract which declares the reads: the contract's declaration counts. */
export declare class MailReader implements MailBox {
    status(id: string): Promise<string>
    list(): Promise<ReadonlyArray<string>>
    send(to: string): Promise<void>
}

/** Fixture: a client class with no contract declares its reads through an interface of its own name merged with it. */
export interface MailClient extends OutsideReads<"status"> {}

/** Fixture: the client class the merged interface declares the reads of. */
export declare class MailClient {
    status(id: string): Promise<string>
    send(to: string): Promise<void>
}
