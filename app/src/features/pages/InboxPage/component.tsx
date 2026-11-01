import { Alert, Grid } from "@starci/grammar/core"
import type { ActionResult } from "@contract"
import { InboxDetailBlock } from "../../../components/blocks/InboxDetailBlock"
import { InboxPageBlock } from "../../../components/blocks/InboxPageBlock"
import { InboxListBlock } from "../../../components/blocks/InboxListBlock"
import { OwnerRequestBlock } from "../../../components/blocks/OwnerRequestBlock"
import type { ResultNotice } from "../../../modules/types"

/** Complete input of InboxPageBase: the selection the two blocks share, and the last ruling sent. */
export interface InboxPageBaseProps {
    readonly props: { readonly selectedKey: string | null; readonly lastSent: ResultNotice | null }
    readonly on: {
        readonly select: (key: string) => void
        readonly sent: (result: ActionResult, key: string, nextKey: string | null) => void
    }
}

/** Pure half: the inbox Page, the last ruling's outcome, the list on the rail and the selected decision beside it. */
export const InboxPageBase = (props: InboxPageBaseProps) => {
    const { selectedKey, lastSent } = props.props
    return (
        <InboxPageBlock>
            {lastSent === null ? null : <Alert key={lastSent.n} tone="affirmative" title={lastSent.title} description={lastSent.description} />}
            <Grid
                kind="main-rail"
                primary={<InboxDetailBlock selectedKey={selectedKey} onSent={props.on.sent} />}
                rail={
                    <div className="app-stack">
                        <InboxListBlock selectedKey={selectedKey} onSelect={props.on.select} />
                        <OwnerRequestBlock />
                    </div>
                }
                railPosition="leading"
                railWidth="wide"
                collapsedOrder="rail-first"
            />
        </InboxPageBlock>
    )
}
