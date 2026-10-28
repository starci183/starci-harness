import { useState } from "react"
import type { ReactNode } from "react"
import { Button } from "@starci/grammar/common"

/** The resolved labels of the toggle and the content it shows; the branch owns only whether it is open. */
type {{Name}}Props = {
    readonly showLabel: string
    readonly hideLabel: string
    readonly children: ReactNode
}

/** Holds its intrinsic state alone (open or closed); it reads no data, resolves no copy and renders below a client block. */
export const {{Name}} = (props: {{Name}}Props) => {
    const [isOpen, setIsOpen] = useState(false)
    return (
        <>
            <Button intent="neutral" onPress={() => setIsOpen((current) => !current)}>
                {isOpen ? props.hideLabel : props.showLabel}
            </Button>
            {isOpen ? props.children : null}
        </>
    )
}
