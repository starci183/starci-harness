import { Column, Entity, PrimaryColumn } from "typeorm"

@Entity({ schema: "public", name: "http_security_rate_windows" })
/** One rate limit window of one caller and tier, mapped from public.http_security_rate_windows of the baseline migration in db/migrations. */
export class RateWindowEntity {
    /** The tier and caller address the window counts. */
    @PrimaryColumn({ name: "key", type: "varchar", length: 128 })
    key!: string

    /** The hits counted in the window. */
    @Column({ name: "hits", type: "integer" })
    hits!: number

    /** When the window ends; a hit after it opens a fresh one. */
    @Column({ name: "reset_at", type: "timestamptz" })
    resetAt!: Date
}
