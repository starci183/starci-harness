import type { OwnerRequestRow, ProjectSummary } from "@contract"
import { toastQueue } from "@starci/grammar/core"
import { useState } from "react"
import { useActionCommand, useOverviewQuery, useOwnerRequestsQuery } from "../../../hooks/query"
import { mapSlot, slotOfQuery, useSlotLabels } from "../../../hooks/slot"
import { OWNER_REQUEST } from "../../../modules/i18n"
import { OwnerRequestBlockBase, type OwnerRequestItemView, type ProjectOptionView } from "./component"

const toProject = (project: ProjectSummary): ProjectOptionView => ({ value: project.key, label: project.name })

/** The command a send runs, shown under the button. */
const COMMAND = "starci supervisor ask"

/** Open requests read as waiting on the Supervisor (warning); a closed one carries the command that closed it. */
const toRequest = (request: OwnerRequestRow): OwnerRequestItemView => ({
    id: request.id,
    project: request.project,
    text: request.text,
    status:
        request.status === "open"
            ? { label: OWNER_REQUEST.open, tone: "warning" }
            : { label: request.cmdId === null ? OWNER_REQUEST.closed : OWNER_REQUEST.closedBy(request.cmdId), tone: "success" },
})

/**
 * The composer that hands a project's Supervisor a request (`starci supervisor ask`, as the owner) and the requests handed over so
 * far. A refused or failed send is a toast; the two reads each show their own error with a retry.
 */
export const OwnerRequestBlock = () => {
    const projectsQuery = useOverviewQuery()
    const requestsQuery = useOwnerRequestsQuery()
    const { send } = useActionCommand()
    const slotLabels = useSlotLabels()
    const [project, setProject] = useState<string | null>(null)
    const [text, setText] = useState("")
    const [isPending, setIsPending] = useState(false)

    const projects = mapSlot(slotOfQuery(projectsQuery), (overview) => overview.projects.map(toProject))
    const chosen = project ?? (projects.items?.length === 1 ? (projects.items[0]?.value ?? null) : null)
    const canSend = chosen !== null && text.trim() !== ""

    const submit = async () => {
        if (chosen === null || !canSend) return
        setIsPending(true)
        const result = await send({ kind: "ownerRequest", set: { project: chosen, text: text.trim() } })
        setIsPending(false)
        if (!result.ok) {
            toastQueue.add({
                tone: "negative",
                title: result.code === null ? OWNER_REQUEST.refused : `${OWNER_REQUEST.refused} · ${result.code}`,
                description: result.message,
            })
            return
        }
        setText("")
        toastQueue.add({ tone: "affirmative", title: OWNER_REQUEST.sent, description: result.message })
    }

    return (
        <OwnerRequestBlockBase
            props={{
                projects,
                requests: mapSlot(slotOfQuery(requestsQuery), (rows) => rows.map(toRequest)),
                project: chosen,
                text,
                canSend,
                isPending,
                labels: {
                    card: OWNER_REQUEST.card,
                    project: OWNER_REQUEST.project,
                    projectPlaceholder: OWNER_REQUEST.projectPlaceholder,
                    text: OWNER_REQUEST.text,
                    textHint: OWNER_REQUEST.textHint,
                    send: OWNER_REQUEST.send,
                    commandPrefix: OWNER_REQUEST.commandPrefix,
                    command: COMMAND,
                    commandSuffix: OWNER_REQUEST.commandSuffix,
                    list: OWNER_REQUEST.list,
                    projectsSlot: slotLabels(OWNER_REQUEST.noProjects),
                    requestsSlot: slotLabels(OWNER_REQUEST.empty, OWNER_REQUEST.emptyHint),
                },
            }}
            on={{
                retryProjects: () => void projectsQuery.refetch(),
                retryRequests: () => void requestsQuery.refetch(),
                setProject,
                setText,
                send: () => void submit(),
            }}
        />
    )
}
