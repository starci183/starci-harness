import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { Overview } from "@contract"
import { api, queryKeys } from "../../modules/api"

/** Screen 1's read: projects, providers, workflows, events and the host. */
export const useOverviewQuery = (): UseQueryResult<Overview, Error> => useQuery({ queryKey: queryKeys.overview, queryFn: api.overview })
