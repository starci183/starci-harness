"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { {{Name}}Base } from "./component"

/** The connected {{Name}}: owns whether it is open, resolves every label and renders its pure half. */
export const {{Name}} = () => {
    const t = useTranslations("{{nameCamel}}")
    const [isOpen, setIsOpen] = useState(false)
    return (
        <{{Name}}Base
            props={{
                isOpen,
                triggerLabel: t("open"),
                title: t("title"),
{{labelsResolved}}                cancelLabel: t("cancel"),
                submitLabel: t("submit"),
            }}
            on={{ openChange: setIsOpen, {{submitHandler}} }}
        />
    )
}
