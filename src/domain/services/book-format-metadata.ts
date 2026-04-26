import { BookFileMetadata } from 'src/application/interfaces/book-metadata-parser';
import { Book } from 'src/domain/entities/book.entity';
import { BookFormat, BookFormatProps } from 'src/domain/entities/book-format.entity';
import { fillBookMetadataFromFileName } from 'src/domain/services/book-file-metadata';

export type BookFormatMetadataFields = Pick<
  BookFormat,
  | 'title'
  | 'author'
  | 'genres'
  | 'publishedYear'
  | 'coverImageFileName'
  | 'summary'
  | 'series'
  | 'seriesPosition'
  | 'isbn'
  | 'pageCount'
  | 'publisher'
  | 'language'
>;

export function buildBookFormatMetadata(
  fileMetadata: BookFileMetadata,
  fileName: string,
  coverImageFileName?: string,
): BookFormatMetadataFields {
  const seededMetadata = fillBookMetadataFromFileName({ ...fileMetadata }, fileName);

  return {
    title: seededMetadata.title,
    author: seededMetadata.author,
    genres: seededMetadata.genres,
    publishedYear: seededMetadata.publishedYear,
    coverImageFileName,
    summary: seededMetadata.summary,
    series: seededMetadata.series,
    seriesPosition: seededMetadata.seriesPosition,
    isbn: seededMetadata.isbn,
    pageCount: seededMetadata.pageCount,
    publisher: seededMetadata.publisher,
    language: seededMetadata.language,
  };
}

export function withBookMetadataFallback(format: BookFormat, book: Book): BookFormat {
  return new BookFormat({
    ...format,
    title: format.title ?? book.title,
    author: format.author ?? book.author,
    genres: format.genres ?? book.genres,
    publishedYear: format.publishedYear ?? book.publishedYear,
    coverImageFileName: format.coverImageFileName ?? book.coverImageFileName,
    summary: format.summary ?? book.summary,
    series: format.series ?? book.series,
    seriesPosition: format.seriesPosition ?? book.seriesPosition,
    isbn: format.isbn ?? book.isbn,
    pageCount: format.pageCount ?? book.pageCount,
    publisher: format.publisher ?? book.publisher,
    language: format.language ?? book.language,
  });
}

export function toBookOverridesFromFormat(format: BookFormat): Partial<Book> {
  return {
    title: format.title,
    author: format.author,
    genres: format.genres,
    publishedYear: format.publishedYear,
    coverImageFileName: format.coverImageFileName,
    summary: format.summary,
    series: format.series,
    seriesPosition: format.seriesPosition,
    isbn: format.isbn,
    pageCount: format.pageCount,
    publisher: format.publisher,
    language: format.language,
    fileName: format.fileName,
    fileMtime: format.fileMtime,
    fileContentHash: format.fileContentHash,
  };
}

export function hasStoredFormatMetadata(format: { title?: string; author?: string }): boolean {
  return Boolean(format.title || format.author);
}

export function cloneBookFormat(format: BookFormat, overrides: Partial<BookFormatProps> = {}): BookFormat {
  return new BookFormat({
    ...format,
    ...overrides,
  });
}
