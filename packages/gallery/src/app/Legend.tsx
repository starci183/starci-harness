import { Button, Popover, StatusDot, Text } from "@starci/grammar/core"
import type { ReactElement } from "react"
import type { Labels } from "../labels.ts"
import type { Status } from "../model.ts"
import { dotTone, statusLabel } from "./status.ts"

/** The statuses a dot can show, one row each (a screen with no design and no shot has no dot). `codedOnly` shares the dot of `unrecorded`. */
const ROWS: readonly Status[] = ["matches", "differs", "stale", "unrecorded", "codedOnly", "notBuilt"]

/** What each dot means, behind one button of the top bar. */
export function Legend({ labels }: { readonly labels: Labels }): ReactElement {
    return (
        <Popover
            title={labels.legend}
            placement="bottom"
            trigger={
                <Button intent="neutral" size="sm">
                    {labels.legend}
                </Button>
            }
        >
            <ul className="sg-legend">
                {ROWS.map((status) => (
                    <li key={status}>
                        <StatusDot tone={dotTone(status)} aria-label={statusLabel(labels, status)} />
                        <Text size="sm">{statusLabel(labels, status)}</Text>
                    </li>
                ))}
            </ul>
        </Popover>
    )
}
