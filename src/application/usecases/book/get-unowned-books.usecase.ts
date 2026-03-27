import { Inject, Injectable } from '@nestjs/common';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { PaginationResult } from 'src/core/pagination_result';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { Book } from 'src/domain/entities/book.entity';

export interface GetUnownedBooksRequest {
  limit?: number;
  offset?: number;
}

@Injectable()
export class GetUnownedBooksUseCase implements UseCase<GetUnownedBooksRequest, PaginationResult<Book[]>> {
  constructor(@Inject('BookRepository') private readonly bookRepository: IBookRepository) {}

  async execute({ limit = 20, offset = 0 }: GetUnownedBooksRequest): Promise<Result<PaginationResult<Book[]>>> {
    return this.bookRepository.findUnowned(limit, offset);
  }
}
