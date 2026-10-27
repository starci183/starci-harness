import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { TaskDetail } from "@contract"
import { api, queryKeys } from "../../modules/api"

/** Screen 3's read: one task. */
export const useTaskQuery = (project: string, id: string): UseQueryResult<TaskDetail, Error> =>
    useQuery({ queryKey: queryKeys.task(project, id), queryFn: () => api.task(project, id) })
