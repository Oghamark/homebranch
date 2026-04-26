import { Inject, Injectable } from '@nestjs/common';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { Book } from 'src/domain/entities/book.entity';
import { BookFactory } from 'src/domain/entities/book.factory';
import { getAvailableBookFormatsFromBook, getPreferredBookFormat } from 'src/domain/services/book-format';
import { withBookMetadataFallback } from 'src/domain/services/book-format-metadata';
import {
  LinkBooksForbiddenFailure,
  LinkBooksFormatConflictFailure,
  LinkBooksSameBookFailure,
} from 'src/domain/failures/book.failures';

export interface LinkBooksRequest {
  targetBookId: string;
  sourceBookId: string;
  requestingUserId: string;
  requestingUserRole: 'ADMIN' | 'USER';
}

@Injectable()
export class LinkBooksUseCase implements UseCase<LinkBooksRequest, Book> {
  constructor(@Inject('BookRepository') private readonly bookRepository: IBookRepository) {}

  async execute(request: LinkBooksRequest): Promise<Result<Book>> {
    if (request.targetBookId === request.sourceBookId) {
      return Result.fail(new LinkBooksSameBookFailure());
    }

    const [targetResult, sourceResult] = await Promise.all([
      this.bookRepository.findById(request.targetBookId),
      this.bookRepository.findById(request.sourceBookId),
    ]);

    if (!targetResult.isSuccess()) return targetResult;
    if (!sourceResult.isSuccess()) return sourceResult;

    const targetBook = targetResult.value;
    const sourceBook = sourceResult.value;

    const canLink =
      request.requestingUserRole === 'ADMIN' ||
      (targetBook.uploadedByUserId === request.requestingUserId && sourceBook.uploadedByUserId === request.requestingUserId);
    if (!canLink) {
      return Result.fail(new LinkBooksForbiddenFailure());
    }

    const targetFormats = getAvailableBookFormatsFromBook(targetBook).map((format) => withBookMetadataFallback(format, targetBook));
    const sourceFormats = getAvailableBookFormatsFromBook(sourceBook).map((format) => withBookMetadataFallback(format, sourceBook));
    const conflictingFormat = sourceFormats.find((sourceFormat) =>
      targetFormats.some((targetFormat) => targetFormat.format === sourceFormat.format),
    );
    if (conflictingFormat) {
      return Result.fail(new LinkBooksFormatConflictFailure(conflictingFormat.format));
    }

    const mergedFormats = [...targetFormats, ...sourceFormats];
    const preferredFormat = getPreferredBookFormat(mergedFormats);
    const transferredCoverImage =
      targetBook.coverImageFileName ?? sourceBook.coverImageFileName ?? targetBook.coverImageFileName;

    const mergedBook = BookFactory.reconstitute(targetBook, {
      coverImageFileName: transferredCoverImage,
      summary: targetBook.summary ?? sourceBook.summary,
      genres: targetBook.genres?.length ? targetBook.genres : sourceBook.genres,
      publishedYear: targetBook.publishedYear ?? sourceBook.publishedYear,
      uploadedByUserId: targetBook.uploadedByUserId ?? sourceBook.uploadedByUserId,
      series: targetBook.series ?? sourceBook.series,
      seriesPosition: targetBook.seriesPosition ?? sourceBook.seriesPosition,
      isbn: targetBook.isbn ?? sourceBook.isbn,
      pageCount: targetBook.pageCount ?? sourceBook.pageCount,
      publisher: targetBook.publisher ?? sourceBook.publisher,
      language: targetBook.language ?? sourceBook.language,
      averageRating: targetBook.averageRating ?? sourceBook.averageRating,
      ratingsCount: targetBook.ratingsCount ?? sourceBook.ratingsCount,
      metadataFetchedAt: targetBook.metadataFetchedAt ?? sourceBook.metadataFetchedAt,
      lastSyncedAt: targetBook.lastSyncedAt ?? sourceBook.lastSyncedAt,
      syncedMetadata: targetBook.syncedMetadata ?? sourceBook.syncedMetadata,
      fileName: preferredFormat?.fileName ?? targetBook.fileName,
      fileMtime: preferredFormat?.fileMtime ?? targetBook.fileMtime,
      fileContentHash: preferredFormat?.fileContentHash ?? targetBook.fileContentHash,
      formats: mergedFormats,
      metadataUpdatedAt: new Date(),
    });

    const updateTargetResult = await this.bookRepository.update(targetBook.id, mergedBook);
    if (!updateTargetResult.isSuccess()) return updateTargetResult;

    const preparedSourceBook = BookFactory.reconstitute(sourceBook, {
      coverImageFileName:
        transferredCoverImage === sourceBook.coverImageFileName ? undefined : sourceBook.coverImageFileName,
      formats: [],
    });
    const updateSourceResult = await this.bookRepository.update(sourceBook.id, preparedSourceBook);
    if (!updateSourceResult.isSuccess()) return Result.fail(updateSourceResult.failure!);

    const deleteSourceResult = await this.bookRepository.permanentDelete(sourceBook.id);
    if (!deleteSourceResult.isSuccess()) return Result.fail(deleteSourceResult.failure!);

    return updateTargetResult;
  }
}
