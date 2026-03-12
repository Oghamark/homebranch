import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncAndSoftDeleteFields1773287271444 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP NULL`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMP NULL`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "synced_metadata" JSONB NULL`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "file_mtime" BIGINT NULL`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "file_content_hash" VARCHAR NULL`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "metadata_updated_at" TIMESTAMP NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "metadata_updated_at"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "file_content_hash"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "file_mtime"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "synced_metadata"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "last_synced_at"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "deleted_at"`);
  }
}
