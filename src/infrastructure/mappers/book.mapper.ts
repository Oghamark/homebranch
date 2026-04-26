import { Book } from 'src/domain/entities/book.entity';
import { BookFormat } from 'src/domain/entities/book-format.entity';
import { BookEntity } from 'src/infrastructure/database/book.entity';
import { BookFormatEntity } from 'src/infrastructure/database/book-format.entity';
import { BookFactory } from 'src/domain/entities/book.factory';

export class BookMapper {
  static toDomain(bookEntity: BookEntity): Book {
    return BookFactory.create(
      bookEntity.id,
      bookEntity.title,
      bookEntity.author,
      bookEntity.fileName,
      bookEntity.isFavorite,
      bookEntity.genres,
      bookEntity.publishedYear,
      bookEntity.coverImageFileName,
      bookEntity.summary,
      bookEntity.uploadedByUserId,
      bookEntity.series,
      bookEntity.seriesPosition,
      bookEntity.isbn,
      bookEntity.pageCount,
      bookEntity.publisher,
      bookEntity.language,
      bookEntity.averageRating,
      bookEntity.ratingsCount,
      bookEntity.metadataFetchedAt,
      bookEntity.createdAt,
      bookEntity.deletedAt,
      bookEntity.lastSyncedAt,
      bookEntity.syncedMetadata,
      bookEntity.fileMtime,
      bookEntity.fileContentHash,
      bookEntity.metadataUpdatedAt,
      bookEntity.formats?.map((format) => this.toDomainFormat(format)),
    );
  }

  static toPersistence(book: Book): BookEntity {
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      fileName: book.fileName,
      isFavorite: book.isFavorite,
      publishedYear: book.publishedYear,
      coverImageFileName: book.coverImageFileName,
      summary: book.summary,
      uploadedByUserId: book.uploadedByUserId,
      genres: book.genres,
      series: book.series,
      seriesPosition: book.seriesPosition,
      isbn: book.isbn,
      pageCount: book.pageCount,
      publisher: book.publisher,
      language: book.language,
      averageRating: book.averageRating,
      ratingsCount: book.ratingsCount,
      metadataFetchedAt: book.metadataFetchedAt,
      createdAt: book.createdAt ?? new Date(),
      deletedAt: book.deletedAt ?? (null as unknown as undefined),
      lastSyncedAt: book.lastSyncedAt,
      syncedMetadata: book.syncedMetadata,
      fileMtime: book.fileMtime,
      fileContentHash: book.fileContentHash,
      metadataUpdatedAt: book.metadataUpdatedAt,
      formats: book.formats?.map((format) => this.toPersistenceFormat(format, book.id)),
    };
  }

  static toDomainList(bookEntityList: BookEntity[]): Book[] {
    return bookEntityList.map((bookEntity) => this.toDomain(bookEntity));
  }

  static toPersistenceList(bookList: Book[]): BookEntity[] {
    return bookList.map((book) => this.toPersistence(book));
  }

  private static toDomainFormat(formatEntity: BookFormatEntity): BookFormat {
    return new BookFormat({
      id: formatEntity.id,
      format: formatEntity.format,
      fileName: formatEntity.fileName,
      fileMtime: formatEntity.fileMtime,
      fileContentHash: formatEntity.fileContentHash,
      createdAt: formatEntity.createdAt,
      title: formatEntity.title,
      author: formatEntity.author,
      genres: formatEntity.genres,
      publishedYear: formatEntity.publishedYear,
      coverImageFileName: formatEntity.coverImageFileName,
      summary: formatEntity.summary,
      series: formatEntity.series,
      seriesPosition: formatEntity.seriesPosition,
      isbn: formatEntity.isbn,
      pageCount: formatEntity.pageCount,
      publisher: formatEntity.publisher,
      language: formatEntity.language,
    });
  }

  private static toPersistenceFormat(format: BookFormat, bookId: string): BookFormatEntity {
    const entity = new BookFormatEntity();
    entity.id = format.id;
    entity.bookId = bookId;
    entity.format = format.format;
    entity.fileName = format.fileName;
    entity.fileMtime = format.fileMtime;
    entity.fileContentHash = format.fileContentHash;
    entity.title = format.title;
    entity.author = format.author;
    entity.genres = format.genres;
    entity.publishedYear = format.publishedYear;
    entity.coverImageFileName = format.coverImageFileName;
    entity.summary = format.summary;
    entity.series = format.series;
    entity.seriesPosition = format.seriesPosition;
    entity.isbn = format.isbn;
    entity.pageCount = format.pageCount;
    entity.publisher = format.publisher;
    entity.language = format.language;
    entity.createdAt = format.createdAt ?? new Date();
    return entity;
  }
}
