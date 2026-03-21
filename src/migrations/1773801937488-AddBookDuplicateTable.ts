import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookDuplicateTable1773801937488 implements MigrationInterface {
  name = 'AddBookDuplicateTable1773801937488';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "book_duplicate_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "suspect_book_id" uuid NOT NULL,
        "original_book_id" uuid NOT NULL,
        "detected_at" TIMESTAMP NOT NULL DEFAULT now(),
        "resolved_at" TIMESTAMP,
        "resolution" character varying,
        "resolved_by_user_id" character varying,
        CONSTRAINT "PK_book_duplicate_entity" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "book_duplicate_entity"
        ADD CONSTRAINT "FK_book_duplicate_suspect"
        FOREIGN KEY ("suspect_book_id") REFERENCES "book_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "book_duplicate_entity"
        ADD CONSTRAINT "FK_book_duplicate_original"
        FOREIGN KEY ("original_book_id") REFERENCES "book_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_book_duplicate_suspect_book_id" ON "book_duplicate_entity" ("suspect_book_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_book_duplicate_original_book_id" ON "book_duplicate_entity" ("original_book_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_book_duplicate_resolved_at" ON "book_duplicate_entity" ("resolved_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_book_duplicate_resolved_at"`);
    await queryRunner.query(`DROP INDEX "IDX_book_duplicate_original_book_id"`);
    await queryRunner.query(`DROP INDEX "IDX_book_duplicate_suspect_book_id"`);
    await queryRunner.query(`ALTER TABLE "book_duplicate_entity" DROP CONSTRAINT "FK_book_duplicate_original"`);
    await queryRunner.query(`ALTER TABLE "book_duplicate_entity" DROP CONSTRAINT "FK_book_duplicate_suspect"`);
    await queryRunner.query(`DROP TABLE "book_duplicate_entity"`);
  }
}
