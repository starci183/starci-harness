import { z } from "zod"

export const orderSchema = z.object({ id: z.string().max(36), lines: z.array(z.string().max(64)).max(100) })
export type OrderPayload = z.infer<typeof orderSchema>
