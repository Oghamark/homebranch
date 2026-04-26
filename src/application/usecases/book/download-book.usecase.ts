import { Inject, Injectable } from '@nestjs/common';
import { IBookRepository } from '../../interfaces/book-repository';
import { Book } from 'src/domain/entities/book.entity';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { BookFormatType } from 'src/domain/entities/book-format.entity';
import { getDefaultBookFormatType, getRequestedBookFormatFromBook } from 'src/domain/services/book-format';
import { BookFormatNotAvailableFailure } from 'src/domain/failures/book.failures';

export interface DownloadBookRequest {
  id: string;
  format?: BookFormatType;
}

export interface DownloadBookResult {
  book: Book;
  format: BookFormatType;
  fileName: string;
}

@Injectable()
export class DownloadBookUseCase implements UseCase<DownloadBookRequest, DownloadBookResult> {
  constructor(@Inject('BookRepository') private bookRepository: IBookRepository) {}

  async execute({ id, format }: DownloadBookRequest): Promise<Result<DownloadBookResult>> {
    const bookResult = await this.bookRepository.findById(id);
    if (bookResult.isFailure()) return Result.fail(bookResult.failure);
    const book = bookResult.value!;

    const selectedFormat = getRequestedBookFormatFromBook(book, format);
    if (!selectedFormat) return Result.fail(new BookFormatNotAvailableFailure(format ?? getDefaultBookFormatType()));

    return Result.ok({
      book,
      format: selectedFormat.format,
      fileName: selectedFormat.fileName,
    });
  }
}
