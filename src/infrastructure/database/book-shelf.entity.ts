import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BookEntity } from 'src/infrastructure/database/book.entity';

@Entity()
export class BookShelfEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @OneToMany(() => BookEntity, (book) => book.bookShelf)
  books: BookEntity[];
}
