import { Book } from 'src/domain/entities/book.entity';
import { Result } from '../../core/result';
import { PaginationResult } from '../../core/pagination_result';
import { IRepository } from '../../core/repository';
import { BookShelf } from '../../domain/entities/bookshelf.entity';

export interface IBookRepository extends IRepository<Book> {
  findByAuthor(
    authorId: string,
    limit?: number,
    offset?: number,
  ): Promise<Result<PaginationResult<Book[]>>>;
  findFavorites(
    limit?: number,
    offset?: number,
  ): Promise<Result<PaginationResult<Book[]>>>;
  findByTitle(title: string): Promise<Result<Book>>;
  findByBookShelfId(
    bookShelf: BookShelf,
    limit?: number,
    offset?: number,
  ): Promise<Result<PaginationResult<Book[]>>>;
}
