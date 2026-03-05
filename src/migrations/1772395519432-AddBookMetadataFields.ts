import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookMetadataFields1772395519432 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "genres" text NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "series" character varying`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "series_position" integer`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "isbn" character varying`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "page_count" integer`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "publisher" character varying`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "language" character varying`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "average_rating" double precision`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "ratings_count" integer`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "metadata_fetched_at" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "metadata_fetched_at"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "ratings_count"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "average_rating"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "language"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "publisher"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "page_count"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "isbn"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "series_position"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "series"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "genres"`);
  }
}
