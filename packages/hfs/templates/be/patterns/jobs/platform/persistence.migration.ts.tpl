import type { MigrationInterface, QueryRunner } from "typeorm"

/** Creates the job table the fenced jobs claim and settle their rows in. */
export class CreateJobs@@epochMs13@@ implements MigrationInterface {
    name = "CreateJobs@@epochMs13@@"

    /** Creates the table; the job key is unique and the token starts at 1 with the first claim. */
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind varchar(200) NOT NULL,
    job_key varchar(200) NOT NULL UNIQUE,
    status varchar(32) NOT NULL CHECK (status IN ('running', 'failed', 'failed_awaiting_fix', 'done')),
    current_step varchar(200),
    fencing_token bigint NOT NULL CHECK (fencing_token >= 1),
    claimed_by varchar(200),
    lease_expires_at timestamptz,
    payload jsonb NOT NULL,
    error text,
    failure_class varchar(16) CHECK (failure_class IN ('transient', 'input', 'code', 'config')),
    parked_build varchar(200),
    parked_at timestamptz,
    alerted_at timestamptz,
    resume_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
)`)
    }

    /** Drops the table. */
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE jobs`)
    }
}
