import { Inject, Injectable } from '@nestjs/common';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { IBookDuplicateRepository, BookDuplicateWithBooks } from '../../interfaces/book-duplicate-repository';
import { PaginationResult } from 'src/core/pagination_result';

export interface ListDuplicatesRequest {
  limit?: number;
  offset?: number;
}

@Injectable()
export class ListDuplicatesUseCase
  implements UseCase<ListDuplicatesRequest, PaginationResult<BookDuplicateWithBooks[]>>
{
  constructor(@Inject('BookDuplicateRepository') private readonly duplicateRepository: IBookDuplicateRepository) {}

  async execute({ limit, offset }: ListDuplicatesRequest): Promise<Result<PaginationResult<BookDuplicateWithBooks[]>>> {
    return this.duplicateRepository.listUnresolved(limit, offset);
  }
}
