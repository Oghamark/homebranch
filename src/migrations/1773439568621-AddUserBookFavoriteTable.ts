import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserBookFavoriteTable1773439568621 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_book_favorite" (
        "user_id" character varying NOT NULL,
        "book_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_book_favorite" PRIMARY KEY ("user_id", "book_id"),
        CONSTRAINT "FK_user_book_favorite_book" FOREIGN KEY ("book_id") REFERENCES "book_entity"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_user_book_favorite_user_id" ON "user_book_favorite" ("user_id")
    `);
    // Migrate existing favorites: for books with is_favorite = true, insert a row for the uploader
    await queryRunner.query(`
      INSERT INTO "user_book_favorite" ("user_id", "book_id")
      SELECT "uploaded_by_user_id", "id"
      FROM "book_entity"
      WHERE "is_favorite" = true AND "uploaded_by_user_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_user_book_favorite_user_id"`);
    await queryRunner.query(`DROP TABLE "user_book_favorite"`);
  }
}
