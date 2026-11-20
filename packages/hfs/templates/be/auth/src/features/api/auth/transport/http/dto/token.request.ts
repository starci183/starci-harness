// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { IsString, MaxLength, MinLength } from "class-validator"

/** The posted link token. */
export class TokenRequest {
    /** The token the link carries. */
    @IsString()
    @MinLength(16)
    @MaxLength(256)
    token!: string
}
