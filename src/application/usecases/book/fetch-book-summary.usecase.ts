import { Inject, Injectable, Logger } from '@nestjs/common';
import { IBookRepository } from '../../interfaces/book-repository';
import { Book } from 'src/domain/entities/book.entity';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { ISummaryGateway } from 'src/application/interfaces/summary-gateway';

export interface FetchBookSummaryRequest {
  id: string;
}

@Injectable()
export class FetchBookSummaryUseCase implements UseCase<FetchBookSummaryRequest, Book> {
  private readonly logger = new Logger(FetchBookSummaryUseCase.name);

  constructor(
    @Inject('BookRepository') private bookRepository: IBookRepository,
    @Inject('SummaryGateway') private summaryGateway: ISummaryGateway,
  ) {}

  async execute(request: FetchBookSummaryRequest): Promise<Result<Book>> {
    this.logger.log(`Fetching summary for book "${request.id}"`);

    const findResult = await this.bookRepository.findById(request.id);
    if (!findResult.isSuccess()) {
      return findResult;
    }

    const book = findResult.value;
    const summary = await this.summaryGateway.fetchSummary(book);

    if (!summary) {
      this.logger.log(`No summary found for "${book.title}"`);
      return Result.ok(book);
    }

    book.summary = summary;
    return await this.bookRepository.update(request.id, book);
  }
}
