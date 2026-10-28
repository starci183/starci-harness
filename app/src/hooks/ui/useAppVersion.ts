import { useEffect, useState } from "react"
import { isTauri } from "../../modules/api/client"

/** The running app's version: the Tauri shell's, or null in a browser build where there is no shell to ask. */
export const useAppVersion = (): string | null => {
    const [version, setVersion] = useState<string | null>(null)
    useEffect(() => {
        if (!isTauri()) return
        let isCurrent = true
        void import("@tauri-apps/api/app")
            .then(({ getVersion }) => getVersion())
            .then((value) => {
                if (isCurrent) setVersion(value)
            })
            .catch(() => undefined)
        return () => {
            isCurrent = false
        }
    }, [])
    return version
}
