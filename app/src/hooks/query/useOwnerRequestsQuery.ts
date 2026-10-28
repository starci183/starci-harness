import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { OwnerRequestRow } from "@contract"
import { api, queryKeys } from "../../modules/api"

/** How often the list re-reads: a Supervisor command closes a request in the mailbox without any live event naming it. */
const REFRESH_MS = 5000

/** The owner requests handed to Supervisors, open and closed, newest first. */
export const useOwnerRequestsQuery = (): UseQueryResult<OwnerRequestRow[], Error> =>
    useQuery({ queryKey: queryKeys.ownerRequests, queryFn: api.ownerRequests, refetchInterval: REFRESH_MS })
