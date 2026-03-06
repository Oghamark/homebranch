import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSettingTable1772669702941 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "setting_entity" (
        "key" character varying NOT NULL,
        "value" text NOT NULL,
        CONSTRAINT "PK_setting_entity" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "setting_entity"`);
  }
}
