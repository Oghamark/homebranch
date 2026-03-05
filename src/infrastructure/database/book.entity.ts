import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
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

  @Column({ type: 'simple-array', nullable: true, default: '' })
  genres: string[];

  @Column({ name: 'published_year', nullable: true })
  publishedYear?: number;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'cover_image_file_name', nullable: true })
  coverImageFileName?: string;

  @Column({ type: 'text', nullable: true, default: null })
  summary?: string;

  @Column({ name: 'uploaded_by_user_id', nullable: true })
  uploadedByUserId?: string;

  @Column({ nullable: true })
  series?: string;

  @Column({ name: 'series_position', nullable: true })
  seriesPosition?: number;

  @Column({ nullable: true })
  isbn?: string;

  @Column({ name: 'page_count', nullable: true })
  pageCount?: number;

  @Column({ nullable: true })
  publisher?: string;

  @Column({ nullable: true })
  language?: string;

  @Column({ name: 'average_rating', nullable: true })
  averageRating?: number;

  @Column({ name: 'ratings_count', nullable: true })
  ratingsCount?: number;

  @Column({ name: 'metadata_fetched_at', nullable: true })
  metadataFetchedAt?: Date;

  @ManyToMany(() => BookShelfEntity, (bookShelf) => bookShelf.books)
  bookShelves?: BookShelfEntity[];
}
