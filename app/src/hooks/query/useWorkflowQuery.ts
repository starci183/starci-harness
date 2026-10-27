import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { WorkflowDetail } from "@contract"
import { api, queryKeys } from "../../modules/api"

/** Screen 2's read: one workflow. */
export const useWorkflowQuery = (project: string, id: string): UseQueryResult<WorkflowDetail, Error> =>
    useQuery({ queryKey: queryKeys.workflow(project, id), queryFn: () => api.workflow(project, id) })
