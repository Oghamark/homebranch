import { Inject, Injectable } from '@nestjs/common';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { PaginationResult } from 'src/core/pagination_result';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { Book } from 'src/domain/entities/book.entity';

export interface GetOrphanedBooksRequest {
  knownUserIds?: string[];
  limit?: number;
  offset?: number;
}

@Injectable()
export class GetOrphanedBooksUseCase implements UseCase<GetOrphanedBooksRequest, PaginationResult<Book[]>> {
  constructor(@Inject('BookRepository') private readonly bookRepository: IBookRepository) {}

  async execute({
    knownUserIds = [],
    limit = 20,
    offset = 0,
  }: GetOrphanedBooksRequest): Promise<Result<PaginationResult<Book[]>>> {
    return this.bookRepository.findOrphaned(knownUserIds, limit, offset);
  }
}
