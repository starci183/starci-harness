import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { Decision } from "@contract"
import { api, queryKeys } from "../../modules/api"

/** Screen 4's read: the decisions awaiting the owner. */
export const useInboxQuery = (): UseQueryResult<Decision[], Error> => useQuery({ queryKey: queryKeys.inbox, queryFn: api.inbox })
