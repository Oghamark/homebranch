import { Inject, Injectable } from '@nestjs/common';
import { Result } from '../../../core/result';
import { PaginationResult } from '../../../core/pagination_result';
import { UseCase } from '../../../core/usecase';
import { PaginatedQuery } from '../../../core/paginated-query';
import { BookShelf } from '../../../domain/entities/bookshelf.entity';
import { IBookShelfRepository } from '../../interfaces/bookshelf-repository';

@Injectable()
export class GetBookShelvesUseCase
  implements UseCase<PaginatedQuery, PaginationResult<BookShelf[]>>
{
  constructor(
    @Inject('BookShelfRepository')
    private bookShelfRepository: IBookShelfRepository,
  ) {}

  async execute({
    limit,
    offset,
  }: PaginatedQuery): Promise<Result<PaginationResult<BookShelf[]>>> {
    return await this.bookShelfRepository.findAll(limit, offset);
  }
}
