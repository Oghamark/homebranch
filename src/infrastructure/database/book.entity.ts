import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BookShelfEntity } from 'src/infrastructure/database/book-shelf.entity';

@Entity()
export class BookEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  author: string;

  @Column({ name: 'is_favorite' })
  isFavorite: boolean;

  @Column({ name: 'published_year', nullable: true })
  publishedYear?: number;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'cover_image_file_name', nullable: true })
  coverImageFileName?: string;

  @ManyToOne(() => BookShelfEntity, (bookShelf) => bookShelf.books, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'book_shelf_id' })
  bookShelf?: BookShelfEntity;
}
