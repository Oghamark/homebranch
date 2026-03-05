import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatedAtToBook1772681032915 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "book_entity" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP NOT NULL DEFAULT NOW()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN IF EXISTS "created_at"`);
  }
}
