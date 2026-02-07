import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchemaUpdate1755566512418 implements MigrationInterface {
  name = 'SchemaUpdate1755566512418';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "book_shelf_entity" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, CONSTRAINT "PK_067f8f6174b88cea88ab359d9ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "book_entity" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "author" character varying NOT NULL, "is_favorite" boolean NOT NULL, "published_year" integer, "file_name" character varying NOT NULL, "cover_image_file_name" character varying, "book_shelf_id" uuid, CONSTRAINT "PK_3ea5638ccafa8799838e68fad46" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "book_entity" ADD CONSTRAINT "FK_961aac7c784f67de752fe77b701" FOREIGN KEY ("book_shelf_id") REFERENCES "book_shelf_entity"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "book_entity" DROP CONSTRAINT "FK_961aac7c784f67de752fe77b701"`,
    );
    await queryRunner.query(`DROP TABLE "book_entity"`);
    await queryRunner.query(`DROP TABLE "book_shelf_entity"`);
  }
}
