import { z } from "zod"

export const xpRowSchema = z.object({ userId: z.string().max(36), xp: z.number() })
