import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookFormatTable1774652732886 implements MigrationInterface {
  name = 'AddBookFormatTable1774652732886';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "book_format_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "book_id" uuid NOT NULL,
        "format" character varying NOT NULL,
        "file_name" character varying NOT NULL,
        "file_mtime" bigint,
        "file_content_hash" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_book_format_entity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_book_format_entity_book_id_format" UNIQUE ("book_id", "format"),
        CONSTRAINT "UQ_book_format_entity_file_name" UNIQUE ("file_name")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "book_format_entity"
        ADD CONSTRAINT "FK_book_format_entity_book"
        FOREIGN KEY ("book_id") REFERENCES "book_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_book_format_entity_book_id" ON "book_format_entity" ("book_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_book_format_entity_file_content_hash" ON "book_format_entity" ("file_content_hash")
    `);

    await queryRunner.query(`
      INSERT INTO "book_format_entity" ("book_id", "format", "file_name", "file_mtime", "file_content_hash", "created_at")
      SELECT
        "id",
        CASE
          WHEN LOWER("file_name") LIKE '%.pdf' THEN 'PDF'
          ELSE 'EPUB'
        END,
        "file_name",
        "file_mtime",
        "file_content_hash",
        COALESCE("created_at", now())
      FROM "book_entity"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_book_format_entity_file_content_hash"`);
    await queryRunner.query(`DROP INDEX "IDX_book_format_entity_book_id"`);
    await queryRunner.query(`ALTER TABLE "book_format_entity" DROP CONSTRAINT "FK_book_format_entity_book"`);
    await queryRunner.query(`DROP TABLE "book_format_entity"`);
  }
}
