import { Inject, Injectable } from '@nestjs/common';
import { IBookRepository } from '../interfaces/book-repository';
import { Book } from '../../domain/entities/book.entity';
import { Result } from '../../core/result';
import { UseCase } from '../interfaces/usecase';
import { PaginatedQuery } from '../contracts/paginated-query';
import { PaginationResult } from '../../core/pagination_result';

@Injectable()
export class GetFavoriteBooksUseCase
  implements UseCase<PaginatedQuery, PaginationResult<Book[]>>
{
  constructor(
    @Inject('BookRepository') private bookRepository: IBookRepository,
  ) {}

  async execute({
    limit,
    offset,
  }: PaginatedQuery): Promise<Result<PaginationResult<Book[]>>> {
    return await this.bookRepository.findFavorites(limit, offset);
  }
}
