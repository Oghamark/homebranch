import { Inject, Injectable, Logger } from '@nestjs/common';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import {
  IPublicationContentService,
  PublicationContentEntry,
} from 'src/application/interfaces/publication-content-service';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { BookContentEntryNotFoundFailure } from 'src/domain/failures/book.failures';

export interface GetBookContentRequest {
  id: string;
  entryPath: string;
}

@Injectable()
export class GetBookContentUseCase implements UseCase<GetBookContentRequest, PublicationContentEntry> {
  private readonly logger = new Logger(GetBookContentUseCase.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('PublicationContentService')
    private readonly contentService: IPublicationContentService,
  ) {}

  async execute({ id, entryPath }: GetBookContentRequest): Promise<Result<PublicationContentEntry>> {
    this.logger.log(`Serving content entry "${entryPath}" for book "${id}"`);

    const bookResult = await this.bookRepository.findById(id);
    if (bookResult.isFailure()) return Result.fail(bookResult.failure);

    const entry = this.contentService.getContent(bookResult.value!, entryPath);
    if (!entry) return Result.fail(new BookContentEntryNotFoundFailure(entryPath));

    return Result.ok(entry);
  }
}
