import { BookDuplicate, DuplicateResolution } from 'src/domain/entities/book-duplicate.entity';
import { Book } from 'src/domain/entities/book.entity';
import { Result } from 'src/core/result';
import { PaginationResult } from 'src/core/pagination_result';

export interface BookDuplicateWithBooks {
  duplicate: BookDuplicate;
  suspectBook: Book;
  originalBook: Book;
}

export interface IBookDuplicateRepository {
  create(duplicate: BookDuplicate): Promise<Result<BookDuplicate>>;
  findById(id: string): Promise<Result<BookDuplicate>>;
  findByBookIds(suspectBookId: string, originalBookId: string): Promise<Result<BookDuplicate>>;
  listUnresolved(limit?: number, offset?: number): Promise<Result<PaginationResult<BookDuplicateWithBooks[]>>>;
  resolve(id: string, resolution: DuplicateResolution, resolvedByUserId: string): Promise<Result<BookDuplicate>>;
}
