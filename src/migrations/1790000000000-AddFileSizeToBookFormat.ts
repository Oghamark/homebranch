import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddFileSizeToBookFormat1790000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'book_format_entity',
      new TableColumn({ name: 'file_size', type: 'bigint', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('book_format_entity', 'file_size');
  }
}
