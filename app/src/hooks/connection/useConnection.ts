import { useContext } from "react"
import { ConnectionContext, type ConnectionContextValue } from "./connection.shared"

/** Where the API is, and the doors that change it (connect, disconnect, sample data). */
export const useConnection = (): ConnectionContextValue => {
    const value = useContext(ConnectionContext)
    if (value === null) throw new Error("useConnection outside ConnectionProvider")
    return value
}
