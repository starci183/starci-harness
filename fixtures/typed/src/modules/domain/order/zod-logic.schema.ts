import { z } from "zod"

export const idSchema = z.string().max(36)

export function normalise(id: string): string {
    return idSchema.parse(id).trim().toLowerCase()
}
