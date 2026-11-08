import { useState, type ReactNode } from "react"
import { Button } from "@starci/grammar/common"

/** The resolved labels of the toggle and the slot it shows; the branch owns only whether it is open, and takes no children. */
type {{Name}}Props = {
    readonly showLabel: string
    readonly hideLabel: string
    /** What the toggle shows when open. */
    readonly body: ReactNode
}

/** Holds its intrinsic state alone (open or closed); it reads no data, resolves no copy and renders below a client block. */
export const {{Name}} = (props: {{Name}}Props) => {
    const [isOpen, setIsOpen] = useState(false)
    return (
        <>
            <Button intent="neutral" onPress={() => setIsOpen((current) => !current)}>
                {isOpen ? props.hideLabel : props.showLabel}
            </Button>
            {isOpen ? props.body : null}
        </>
    )
}
