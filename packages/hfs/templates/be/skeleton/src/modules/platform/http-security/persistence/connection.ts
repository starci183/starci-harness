import { RateWindowEntity } from "./entities/rate-window.entity"
import { CreateRateWindows1789900000000 } from "./migrations/1789900000000-create-rate-windows"

/** The entities of the http-security capability, for the primary connection its rate limit counts in. */
export const httpSecurityEntities = [RateWindowEntity]

/** The migrations of the http-security capability, in the order they run. */
export const httpSecurityMigrations = [CreateRateWindows1789900000000]
