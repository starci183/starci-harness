import type { MigrationInterface, QueryRunner } from "typeorm"

/** Creates the rate limit windows every api replica counts in. */
export class CreateRateWindows1789900000000 implements MigrationInterface {
    name = "CreateRateWindows1789900000000"

    /** Creates the windows table and the index the prune reads. */
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE http_security_rate_windows (
    key varchar(128) PRIMARY KEY,
    hits integer NOT NULL CHECK (hits > 0),
    reset_at timestamptz NOT NULL
)`)
        await queryRunner.query(
            `CREATE INDEX ix_http_security_rate_windows_reset_at ON http_security_rate_windows (reset_at)`,
        )
    }

    /** Drops the index and the table. */
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX ix_http_security_rate_windows_reset_at`)
        await queryRunner.query(`DROP TABLE http_security_rate_windows`)
    }
}
