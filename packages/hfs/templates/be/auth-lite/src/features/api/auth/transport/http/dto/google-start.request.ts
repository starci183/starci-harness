// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { IsOptional, IsString, MaxLength } from "class-validator"

/** The query that starts a Google sign-in. */
export class GoogleStartRequest {
    /** An absolute address on the web origin, or a path, to land on afterwards. */
    @IsOptional()
    @IsString()
    @MaxLength(1024)
    returnTo?: string

    /** A path to land on afterwards (the older spelling of returnTo). */
    @IsOptional()
    @IsString()
    @MaxLength(512)
    next?: string
}
