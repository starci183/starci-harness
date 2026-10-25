import { defineOperations, query } from "./index"
import { FakeInputSchema, PlanOutputSchema } from "./plan.schema"

/** A stub table a spec keeps for itself and, wrongly, exports: no route may count it as the app's declared table. */
export const SHADOW = defineOperations({ "plan.purge@1": query({ input: FakeInputSchema, output: PlanOutputSchema }) })
