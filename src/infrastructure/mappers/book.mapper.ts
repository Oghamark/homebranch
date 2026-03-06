import { Book } from 'src/domain/entities/book.entity';
import { BookEntity } from 'src/infrastructure/database/book.entity';
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
    };
  }

  static toDomainList(bookEntityList: BookEntity[]): Book[] {
    return bookEntityList.map((bookEntity) => this.toDomain(bookEntity));
  }

  static toPersistenceList(bookList: Book[]): BookEntity[] {
    return bookList.map((book) => this.toPersistence(book));
  }
}
