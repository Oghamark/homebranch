import { Book } from 'src/domain/entities/book.entity';

export class BookFactory {
  static create(
    id: string,
    title: string,
    author: string,
    fileName: string,
    isFavorite: boolean = false,
    genres: string[] = [],
    publishedYear?: number,
    coverImageFileName?: string,
    summary?: string,
    uploadedByUserId?: string,
    series?: string,
    seriesPosition?: number,
    isbn?: string,
    pageCount?: number,
    publisher?: string,
    language?: string,
    averageRating?: number,
    ratingsCount?: number,
    metadataFetchedAt?: Date,
    createdAt?: Date,
  ): Book {
    if (!title || !author) {
      throw new Error('Title and author are required to create a book.');
    }

    return new Book(
      id,
      title,
      author,
      fileName,
      isFavorite,
      genres,
      publishedYear,
      coverImageFileName,
      summary,
      uploadedByUserId,
      series,
      seriesPosition,
      isbn,
      pageCount,
      publisher,
      language,
      averageRating,
      ratingsCount,
      metadataFetchedAt,
      createdAt,
    );
  }

  static reconstitute(book: Book, overrides: Partial<Book> = {}): Book {
    return new Book(
      overrides.id ?? book.id,
      overrides.title ?? book.title,
      overrides.author ?? book.author,
      overrides.fileName ?? book.fileName,
      overrides.isFavorite ?? book.isFavorite,
      overrides.genres ?? book.genres,
      overrides.publishedYear ?? book.publishedYear,
      overrides.coverImageFileName ?? book.coverImageFileName,
      overrides.summary ?? book.summary,
      overrides.uploadedByUserId ?? book.uploadedByUserId,
      overrides.series ?? book.series,
      overrides.seriesPosition ?? book.seriesPosition,
      overrides.isbn ?? book.isbn,
      overrides.pageCount ?? book.pageCount,
      overrides.publisher ?? book.publisher,
      overrides.language ?? book.language,
      overrides.averageRating ?? book.averageRating,
      overrides.ratingsCount ?? book.ratingsCount,
      overrides.metadataFetchedAt ?? book.metadataFetchedAt,
      overrides.createdAt ?? book.createdAt,
    );
  }
}
