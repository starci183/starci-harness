import type { MigrationInterface, QueryRunner } from "typeorm"

/** Extends the one shared inbox to retain a client operation's request identity and outcome. */
export class ClientOperationOutcomes1792800000000 implements MigrationInterface {
    name = "ClientOperationOutcomes1792800000000"

    /** Adds nullable columns so existing delivery claims retain their meaning. */
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE inbox_claims
ADD COLUMN request_fingerprint varchar(64),
ADD COLUMN outcome jsonb`)
        await queryRunner.query(`CREATE INDEX inbox_claims_client_retention_idx ON inbox_claims (claimed_at, source, event_id)
WHERE source LIKE 'client:%' AND request_fingerprint IS NOT NULL AND outcome IS NOT NULL`)
    }

    /** Removes the client outcome extension. */
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX inbox_claims_client_retention_idx`)
        await queryRunner.query(`ALTER TABLE inbox_claims DROP COLUMN outcome, DROP COLUMN request_fingerprint`)
    }
}
