import type { OutsideReads } from "@modules/platform/effects"

/** Fixture: a mail box port that declares its reads; `send` is not declared, so it is an act. */
export interface MailBox extends OutsideReads<"status" | "list"> {
    status(id: string): Promise<string>
    list(): Promise<ReadonlyArray<string>>
    send(to: string): Promise<void>
}

/** Fixture: a client class that declares its read by implementing the marker. */
export declare class MailReader implements OutsideReads<"status"> {
    status(id: string): Promise<string>
    send(to: string): Promise<void>
}
