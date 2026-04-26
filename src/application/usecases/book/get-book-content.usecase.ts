import { Inject, Injectable, Logger } from '@nestjs/common';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import {
  IPublicationContentService,
  PublicationContentEntry,
} from 'src/application/interfaces/publication-content-service';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { BookContentEntryNotFoundFailure } from 'src/domain/failures/book.failures';
import { BookFactory } from 'src/domain/entities/book.factory';
import { BookFormatType } from 'src/domain/entities/book-format.entity';
import {
  getDefaultBookFormatType,
  getRequestedBookFormatFromBook,
  supportsBookFormatContentEntries,
} from 'src/domain/services/book-format';
import { BookFormatNotAvailableFailure, BookFormatUnsupportedFailure } from 'src/domain/failures/book.failures';

export interface GetBookContentRequest {
  id: string;
  entryPath: string;
  format?: BookFormatType;
}

@Injectable()
export class GetBookContentUseCase implements UseCase<GetBookContentRequest, PublicationContentEntry> {
  private readonly logger = new Logger(GetBookContentUseCase.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('PublicationContentService')
    private readonly contentService: IPublicationContentService,
  ) {}

  async execute({ id, entryPath, format }: GetBookContentRequest): Promise<Result<PublicationContentEntry>> {
    this.logger.log(`Serving content entry "${entryPath}" for book "${id}"`);

    const bookResult = await this.bookRepository.findById(id);
    if (bookResult.isFailure()) return Result.fail(bookResult.failure);
    const book = bookResult.value!;

    const selectedFormat = getRequestedBookFormatFromBook(book, format);
    if (!selectedFormat) return Result.fail(new BookFormatNotAvailableFailure(format ?? getDefaultBookFormatType()));
    if (!supportsBookFormatContentEntries(selectedFormat.format)) {
      return Result.fail(new BookFormatUnsupportedFailure(selectedFormat.format, 'EPUB content access'));
    }

    const entry = this.contentService.getContent(
      BookFactory.reconstitute(book, { fileName: selectedFormat.fileName }),
      entryPath,
    );
    if (!entry) return Result.fail(new BookContentEntryNotFoundFailure(entryPath));

    return Result.ok(entry);
  }
}
