import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { VpsFleet } from "@contract"
import { api, queryKeys } from "../../modules/api"

/** How often the Managed VPS page reads the fleet again: each read probes every server over ssh. */
const REFRESH_MS = 60_000

/** The Managed VPS page's read: every managed server and its health. */
export const useVpsQuery = (): UseQueryResult<VpsFleet, Error> => useQuery({ queryKey: queryKeys.vps, queryFn: api.vps, refetchInterval: REFRESH_MS })
