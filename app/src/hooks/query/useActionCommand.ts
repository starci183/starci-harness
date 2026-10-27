import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"
import type { ActionResult } from "@contract"
import { queryKeys, runAction, type ActionRequest } from "../../modules/api"

const invalidateAfter = (client: QueryClient, action: ActionRequest): Promise<unknown> => {
    switch (action.kind) {
        case "ruling":
            return Promise.all([
                client.invalidateQueries({ queryKey: queryKeys.inbox }),
                client.invalidateQueries({ queryKey: queryKeys.overview }),
            ])
        case "workflow":
        case "goal":
            return Promise.all([
                client.invalidateQueries({ queryKey: queryKeys.workflow(action.project, action.workflow) }),
                client.invalidateQueries({ queryKey: queryKeys.overview }),
            ])
        case "config":
            return client.invalidateQueries({ queryKey: queryKeys.config })
    }
}

/** A failure that never reached the server, reported the way a refused verb is. */
const transportRefusal = (error: unknown): ActionResult => ({
    ok: false,
    code: null,
    message: error instanceof Error ? error.message : String(error),
})

/**
 * The owner's writes, each through a harness verb on the server; it re-reads what the write changed. `send` always
 * resolves: a refused verb with `ok: false`, and a transport failure the same way, so no block catches.
 */
export const useActionCommand = () => {
    const client = useQueryClient()
    const mutation = useMutation<ActionResult, Error, ActionRequest>({
        mutationFn: runAction,
        onSuccess: (_result, action) => invalidateAfter(client, action),
    })
    const send = (request: ActionRequest): Promise<ActionResult> => mutation.mutateAsync(request).catch(transportRefusal)
    return { send, isPending: mutation.isPending }
}
