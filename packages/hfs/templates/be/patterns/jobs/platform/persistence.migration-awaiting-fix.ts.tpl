import type { MigrationInterface, QueryRunner } from "typeorm"

/** Expands the job table for the park (BE-RESILIENCE-2): a failure a retry cannot fix parks the job as failed_awaiting_fix until a resume. */
export class JobsFailedAwaitingFix@@epochMs13@@ implements MigrationInterface {
    name = "JobsFailedAwaitingFix@@epochMs13@@"

    /** Widens the status, adds the park columns; nothing existing changes meaning. */
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE jobs ALTER COLUMN status TYPE varchar(32)`)
        await queryRunner.query(`ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check`)
        await queryRunner.query(`ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('running', 'failed', 'failed_awaiting_fix', 'done'))`)
        await queryRunner.query(`ALTER TABLE jobs ADD COLUMN failure_class varchar(16) CHECK (failure_class IN ('transient', 'input', 'code', 'config'))`)
        await queryRunner.query(`ALTER TABLE jobs ADD COLUMN parked_build varchar(200)`)
        await queryRunner.query(`ALTER TABLE jobs ADD COLUMN parked_at timestamptz`)
        await queryRunner.query(`ALTER TABLE jobs ADD COLUMN alerted_at timestamptz`)
        await queryRunner.query(`ALTER TABLE jobs ADD COLUMN resume_count integer NOT NULL DEFAULT 0`)
    }

    /** Forward-only: the park columns stay. */
    async down(): Promise<void> {
        await Promise.resolve()
    }
}
