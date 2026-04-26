import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillLegacyBookFormats1777228301570 implements MigrationInterface {
  name = 'BackfillLegacyBookFormats1777228301570';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "book_format_entity" (
        "id",
        "book_id",
        "format",
        "file_name",
        "file_mtime",
        "file_content_hash",
        "created_at",
        "title",
        "author",
        "genres",
        "published_year",
        "cover_image_file_name",
        "summary",
        "series",
        "series_position",
        "isbn",
        "page_count",
        "publisher",
        "language"
      )
      SELECT
        uuid_generate_v4(),
        "book"."id",
        CASE
          WHEN LOWER("book"."file_name") LIKE '%.pdf' THEN 'PDF'
          ELSE 'EPUB'
        END,
        "book"."file_name",
        "book"."file_mtime",
        "book"."file_content_hash",
        COALESCE("book"."created_at", now()),
        "book"."title",
        "book"."author",
        COALESCE("book"."genres", ''),
        "book"."published_year",
        "book"."cover_image_file_name",
        "book"."summary",
        "book"."series",
        "book"."series_position",
        "book"."isbn",
        "book"."page_count",
        "book"."publisher",
        "book"."language"
      FROM "book_entity" "book"
      WHERE NOT EXISTS (
        SELECT 1
        FROM "book_format_entity" "format"
        WHERE "format"."book_id" = "book"."id"
          AND "format"."file_name" = "book"."file_name"
      )
    `);
  }

  public async down(): Promise<void> {
    // Irreversible data backfill: legacy rows cannot be distinguished safely from later valid rows.
  }
}
