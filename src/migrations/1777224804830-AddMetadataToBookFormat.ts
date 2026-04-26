import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMetadataToBookFormat1777224804830 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('book_format_entity', [
      new TableColumn({ name: 'title', type: 'varchar', isNullable: true }),
      new TableColumn({ name: 'author', type: 'varchar', isNullable: true }),
      new TableColumn({ name: 'genres', type: 'text', isNullable: true, default: "''" }),
      new TableColumn({ name: 'published_year', type: 'integer', isNullable: true }),
      new TableColumn({ name: 'cover_image_file_name', type: 'varchar', isNullable: true }),
      new TableColumn({ name: 'summary', type: 'text', isNullable: true, default: null }),
      new TableColumn({ name: 'series', type: 'varchar', isNullable: true }),
      new TableColumn({ name: 'series_position', type: 'integer', isNullable: true }),
      new TableColumn({ name: 'isbn', type: 'varchar', isNullable: true }),
      new TableColumn({ name: 'page_count', type: 'integer', isNullable: true }),
      new TableColumn({ name: 'publisher', type: 'varchar', isNullable: true }),
      new TableColumn({ name: 'language', type: 'varchar', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('book_format_entity', [
      'language',
      'publisher',
      'page_count',
      'isbn',
      'series_position',
      'series',
      'summary',
      'cover_image_file_name',
      'published_year',
      'genres',
      'author',
      'title',
    ]);
  }
}
