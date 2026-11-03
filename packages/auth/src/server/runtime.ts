import { randomUUID } from "node:crypto"
import type { AuthClock, AuthIds } from "./ports.ts"

/** The default id source: random UUIDs. */
export const randomIds: AuthIds = { next: () => randomUUID() }

/** The system clock. */
export const systemClock: AuthClock = { now: () => new Date() }
