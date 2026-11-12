import { z } from "zod"

export const scoreRowSchema = z.object({ userId: z.string().max(36), score: z.number() })
