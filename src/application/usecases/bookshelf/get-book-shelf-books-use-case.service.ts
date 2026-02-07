import { Inject, Injectable } from '@nestjs/common';
import { UseCase } from '../../../core/usecase';
import { Book } from '../../../domain/entities/book.entity';
import { PaginationResult } from '../../../core/pagination_result';
import { IBookShelfRepository } from '../../interfaces/bookshelf-repository';
import { Result } from '../../../core/result';
import { BookShelfNotFoundFailure } from '../../../domain/failures/bookshelf.failures';
import { GetBookShelfBooksRequest } from '../../contracts/bookshelf/get-book-shelf-books';
import { IBookRepository } from '../../interfaces/book-repository';

@Injectable()
export class GetBookShelfBooksUseCase
  implements UseCase<GetBookShelfBooksRequest, PaginationResult<Book[]>>
{
  constructor(
    @Inject('BookShelfRepository')
    private bookShelfRepository: IBookShelfRepository,

    @Inject('BookRepository')
    private bookRepository: IBookRepository,
  ) {}

  async execute({
    id,
  }: GetBookShelfBooksRequest): Promise<Result<PaginationResult<Book[]>>> {
    // Verify the bookshelf exists
    const findBookShelfResult = await this.bookShelfRepository.findById(id);

    if (findBookShelfResult.isFailure() || !findBookShelfResult.getValue()) {
      return Result.failure(new BookShelfNotFoundFailure());
    }

    return await this.bookRepository.findByBookShelfId(
      findBookShelfResult.getValue(),
    );
  }
}
