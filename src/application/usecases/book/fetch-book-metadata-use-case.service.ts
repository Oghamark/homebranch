import { Inject, Injectable, Logger } from '@nestjs/common';
import { IBookRepository } from '../../interfaces/book-repository';
import { Book } from 'src/domain/entities/book.entity';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';

export interface FetchBookSummaryRequest {
  id: string;
}

@Injectable()
export class FetchBookMetadataUseCase implements UseCase<FetchBookSummaryRequest, Book> {
  private readonly logger = new Logger(FetchBookMetadataUseCase.name);

  constructor(
    @Inject('BookRepository') private bookRepository: IBookRepository,
    @Inject('MetadataGateway') private metadataGateway: IMetadataGateway,
  ) {}

  async execute(request: FetchBookSummaryRequest): Promise<Result<Book>> {
    this.logger.log(`Fetching metadata for book "${request.id}"`);

    const findResult = await this.bookRepository.findById(request.id);
    if (!findResult.isSuccess()) {
      return findResult;
    }

    const book = findResult.value;
    const enrichedBook = await this.metadataGateway.enrichBook(book);
    return await this.bookRepository.update(request.id, enrichedBook);
  }
}
