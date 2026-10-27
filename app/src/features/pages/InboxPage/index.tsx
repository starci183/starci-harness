import { useState } from "react"
import { INBOX } from "../../../modules/i18n"
import type { ResultNotice } from "../../../modules/types"
import { InboxPageBase } from "./component"

/**
 * Route `/inbox` · Cần quyết định. The page owns no data, only what its two blocks share: which decision is selected, and
 * the outcome of the last ruling sent.
 */
export const InboxPage = () => {
    const [selectedKey, setSelectedKey] = useState<string | null>(null)
    const [lastSent, setLastSent] = useState<ResultNotice | null>(null)
    return (
        <InboxPageBase
            props={{ selectedKey, lastSent }}
            on={{
                select: setSelectedKey,
                sent: (result, _key, nextKey) => {
                    setLastSent((previous) => ({ n: (previous?.n ?? 0) + 1, isOk: true, title: INBOX.sent, description: result.message }))
                    setSelectedKey(nextKey)
                },
            }}
        />
    )
}
