import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IFileService } from 'src/application/interfaces/file-service';
import { BookFileMetadata } from 'src/application/interfaces/book-metadata-parser';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { Book } from 'src/domain/entities/book.entity';
import { BookFactory } from 'src/domain/entities/book.factory';
import { getAvailableBookFormatsFromBook, getPreferredBookFormat } from 'src/domain/services/book-format';
import { fillBookMetadataFromFileName } from 'src/domain/services/book-file-metadata';
import { buildBookFormatMetadata, toBookOverridesFromFormat } from 'src/domain/services/book-format-metadata';
import {
  UnlinkFormatForbiddenFailure,
  UnlinkFormatLastFormatFailure,
  UnlinkFormatNotFoundFailure,
} from 'src/domain/failures/book.failures';
import { BookFormat } from 'src/domain/entities/book-format.entity';
import { BookFormatProcessingService } from 'src/infrastructure/services/book-format-processing.service';
import { join } from 'path';

export interface UnlinkBookFormatRequest {
  bookId: string;
  formatId: string;
  requestingUserId: string;
  requestingUserRole: 'ADMIN' | 'USER';
}

@Injectable()
export class UnlinkBookFormatUseCase implements UseCase<UnlinkBookFormatRequest, Book> {
  private readonly logger = new Logger(UnlinkBookFormatUseCase.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('FileService') private readonly fileService: IFileService,
    private readonly bookFormatProcessingService: BookFormatProcessingService,
  ) {}

  async execute(request: UnlinkBookFormatRequest): Promise<Result<Book>> {
    const bookResult = await this.bookRepository.findById(request.bookId);
    if (!bookResult.isSuccess()) return bookResult;

    const book = bookResult.value;

    const canUnlink =
      request.requestingUserRole === 'ADMIN' || book.uploadedByUserId === request.requestingUserId;
    if (!canUnlink) {
      return Result.fail(new UnlinkFormatForbiddenFailure());
    }

    const formats = getAvailableBookFormatsFromBook(book);
    const formatToRemove = formats.find((f) => f.id === request.formatId);
    if (!formatToRemove) {
      return Result.fail(new UnlinkFormatNotFoundFailure());
    }

    if (formats.length <= 1) {
      return Result.fail(new UnlinkFormatLastFormatFailure());
    }

    const remainingFormats = formats.filter((f) => f.id !== request.formatId);
    const preferredRemaining = getPreferredBookFormat(remainingFormats);

    const updatedBook = BookFactory.reconstitute(book, {
      formats: remainingFormats,
      fileName: preferredRemaining?.fileName ?? book.fileName,
      fileMtime: preferredRemaining?.fileMtime ?? book.fileMtime,
      fileContentHash: preferredRemaining?.fileContentHash ?? book.fileContentHash,
      metadataUpdatedAt: new Date(),
    });

    const splitBook = await this.buildSplitBook(book, formatToRemove);

    return this.bookRepository.splitFormat(book.id, updatedBook, splitBook);
  }

  private async buildSplitBook(book: Book, format: BookFormat): Promise<Book> {
    const fileMetadata = await this.parseFileMetadata(format);
    const coverImageFileName = await this.extractCoverImage(fileMetadata);
    const splitFormat = new BookFormat({
      ...format,
      ...buildBookFormatMetadata(fileMetadata, format.fileName, coverImageFileName),
    });
    const splitBookMetadata = fillBookMetadataFromFileName({ ...toBookOverridesFromFormat(splitFormat) }, format.fileName);

    return BookFactory.create(
      randomUUID(),
      splitBookMetadata.title ?? book.title,
      splitBookMetadata.author ?? book.author,
      splitFormat.fileName,
      false,
      splitBookMetadata.genres ?? [],
      splitBookMetadata.publishedYear,
      splitBookMetadata.coverImageFileName,
      splitBookMetadata.summary,
      book.uploadedByUserId,
      splitBookMetadata.series,
      splitBookMetadata.seriesPosition,
      splitBookMetadata.isbn,
      splitBookMetadata.pageCount,
      splitBookMetadata.publisher,
      splitBookMetadata.language,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      splitFormat.fileMtime,
      splitFormat.fileContentHash,
      undefined,
      [splitFormat],
    );
  }

  private async parseFileMetadata(format: BookFormat): Promise<BookFileMetadata> {
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    const filePath = join(uploadsDirectory, 'books', format.fileName);

    try {
      return await this.bookFormatProcessingService.parseMetadata(filePath, format.format);
    } catch (error) {
      this.logger.warn(`Could not parse metadata for unlinked format "${format.fileName}": ${String(error)}`);
      return {};
    }
  }

  private async extractCoverImage(fileMetadata: BookFileMetadata): Promise<string | undefined> {
    if (!fileMetadata.coverImageBuffer) {
      return undefined;
    }

    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    const coverFileName = `${randomUUID()}.jpg`;
    const coverPath = join(uploadsDirectory, 'cover-images', coverFileName);
    await this.fileService.writeFile(coverPath, fileMetadata.coverImageBuffer);
    return coverFileName;
  }
}
