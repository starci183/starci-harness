import type { ErrorKind, ErrorParams } from "@starci/common"

export type { ErrorKind, ErrorParams } from "@starci/common"

/** One capability's exhaustive code to kind table, as its `<C>_ERROR_KINDS` constant declares it. */
export type ErrorKindTable = Readonly<Record<string, ErrorKind>>

/** Everything a transport needs to answer one failure: the stable code, the kind, the HTTP status and the parameters. */
export interface ErrorDescription {
    /** The stable machine code. */
    readonly code: string
    /** How the failure travels. */
    readonly kind: ErrorKind
    /** The HTTP status of the kind. */
    readonly status: number
    /** Values for the placeholders of the display text. */
    readonly params: ErrorParams
}
