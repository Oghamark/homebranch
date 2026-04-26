import { Inject, Injectable, Logger } from '@nestjs/common';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { IPublicationManifestService } from 'src/application/interfaces/publication-manifest-service';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { BookFactory } from 'src/domain/entities/book.factory';
import { BookFormatType } from 'src/domain/entities/book-format.entity';
import { getDefaultBookFormatType, getRequestedBookFormatFromBook, supportsBookFormatManifest } from 'src/domain/services/book-format';
import { BookFormatNotAvailableFailure, BookFormatUnsupportedFailure } from 'src/domain/failures/book.failures';

export interface GetBookManifestRequest {
  id: string;
  baseUrl: string;
  format?: BookFormatType;
}

@Injectable()
export class GetBookManifestUseCase implements UseCase<GetBookManifestRequest, object> {
  private readonly logger = new Logger(GetBookManifestUseCase.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('PublicationManifestService')
    private readonly manifestService: IPublicationManifestService,
  ) {}

  async execute({ id, baseUrl, format }: GetBookManifestRequest): Promise<Result<object>> {
    this.logger.log(`Generating publication manifest for book "${id}"`);

    const bookResult = await this.bookRepository.findById(id);
    if (bookResult.isFailure()) return Result.fail(bookResult.failure);
    const book = bookResult.value!;

    const selectedFormat = getRequestedBookFormatFromBook(book, format);
    if (!selectedFormat) return Result.fail(new BookFormatNotAvailableFailure(format ?? getDefaultBookFormatType()));
    if (!supportsBookFormatManifest(selectedFormat.format)) {
      return Result.fail(new BookFormatUnsupportedFailure(selectedFormat.format, 'manifest generation'));
    }

    const manifest = this.manifestService.generateManifest(
      BookFactory.reconstitute(book, { fileName: selectedFormat.fileName }),
      baseUrl,
    );
    return Result.ok(manifest);
  }
}
