import { Book } from 'src/domain/entities/book.entity';
import { Result } from 'src/core/result';
import { PaginationResult } from 'src/core/pagination_result';
import { IRepository } from 'src/core/repository';
import { BookShelf } from 'src/domain/entities/bookshelf.entity';

export interface BookSearchFilters {
  query?: string;
  isbn?: string;
  genre?: string;
  series?: string;
  author?: string;
}

export interface IBookRepository extends IRepository<Book> {
  findAll(
    limit?: number,
    offset?: number,
    userId?: string,
    viewerUserId?: string,
  ): Promise<Result<PaginationResult<Book[]>>>;
  findById(id: string, viewerUserId?: string): Promise<Result<Book>>;
  findByAuthor(
    authorId: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>>;
  findFavorites(limit?: number, offset?: number, userId?: string): Promise<Result<PaginationResult<Book[]>>>;
  findByTitle(title: string): Promise<Result<Book>>;
  findByBookShelfId(bookShelf: BookShelf, limit?: number, offset?: number): Promise<Result<PaginationResult<Book[]>>>;
  searchByTitle(
    title: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>>;
  searchFavoritesByTitle(
    title: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>>;
  searchByAuthorAndTitle(
    author: string,
    title: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>>;
  searchWithFilters(
    filters: BookSearchFilters,
    limit?: number,
    offset?: number,
    userId?: string,
    viewerUserId?: string,
  ): Promise<Result<PaginationResult<Book[]>>>;
  searchFavoritesWithFilters(
    filters: BookSearchFilters,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>>;
  toggleFavorite(userId: string, bookId: string): Promise<Result<{ isFavorite: boolean }>>;
  findBooksWithoutMetadata(limit: number): Promise<Result<Book[]>>;
  findNewArrivals(limit?: number, offset?: number): Promise<Result<PaginationResult<Book[]>>>;
  findByFileName(fileName: string, includeDeleted?: boolean): Promise<Result<Book>>;
  findByContentHash(hash: string, includeDeleted?: boolean): Promise<Result<Book>>;
  findAllActive(): Promise<Result<Book[]>>;
  softDelete(id: string): Promise<Result<Book>>;
  restore(id: string): Promise<Result<Book>>;
  permanentDelete(id: string): Promise<Result<Book>>;
  updateContentHash(id: string, hash: string): Promise<Result<void>>;
  findUnowned(limit?: number, offset?: number): Promise<Result<PaginationResult<Book[]>>>;
  findOrphaned(knownUserIds: string[], limit?: number, offset?: number): Promise<Result<PaginationResult<Book[]>>>;
}
