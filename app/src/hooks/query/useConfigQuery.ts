import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { ConfigEntry } from "@contract"
import { api, queryKeys } from "../../modules/api"

/** Screen 5's read: every harness setting. */
export const useConfigQuery = (): UseQueryResult<ConfigEntry[], Error> => useQuery({ queryKey: queryKeys.config, queryFn: api.config })
