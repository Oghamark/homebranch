import { Column, CreateDateColumn, Entity, ManyToMany, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BookShelfEntity } from 'src/infrastructure/database/book-shelf.entity';
import { BookFormatEntity } from 'src/infrastructure/database/book-format.entity';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date;

  @Column({ name: 'last_synced_at', type: 'timestamp', nullable: true })
  lastSyncedAt?: Date;

  @Column({ name: 'synced_metadata', type: 'jsonb', nullable: true })
  syncedMetadata?: Record<string, unknown>;

  @Column({
    name: 'file_mtime',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (v: number | undefined) => (v != null ? Math.round(v) : v),
      from: (v: string | null) => (v ? Number(v) : undefined),
    },
  })
  fileMtime?: number;

  @Column({ name: 'file_content_hash', nullable: true })
  fileContentHash?: string;

  @Column({ name: 'metadata_updated_at', type: 'timestamp', nullable: true })
  metadataUpdatedAt?: Date;

  @ManyToMany(() => BookShelfEntity, (bookShelf) => bookShelf.books)
  bookShelves?: BookShelfEntity[];

  @OneToMany(() => BookFormatEntity, (format) => format.book, {
    cascade: true,
    orphanedRowAction: 'delete',
  })
  formats?: BookFormatEntity[];
}
