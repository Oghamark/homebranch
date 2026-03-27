import { Book } from 'src/domain/entities/book.entity';
import { UpdateBookRequest } from '../../contracts/book/update-book-request';
import { IBookRepository } from '../../interfaces/book-repository';
import { Inject, Injectable } from '@nestjs/common';
import { IFileProcessingQueue } from 'src/application/interfaces/file-processing-queue';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { BookFactory } from 'src/domain/entities/book.factory';

@Injectable()
export class UpdateBookUseCase implements UseCase<UpdateBookRequest, Book> {
  constructor(
    @Inject('BookRepository') private bookRepository: IBookRepository,
    @Inject('FileProcessingQueue') private fileProcessingQueue: IFileProcessingQueue,
  ) {}

  async execute(request: UpdateBookRequest): Promise<Result<Book>> {
    const findBookResult = await this.bookRepository.findById(request.id);
    if (!findBookResult.isSuccess()) {
      return findBookResult;
    }

    const book = BookFactory.reconstitute(findBookResult.value, {
      ...request,
      metadataUpdatedAt: new Date(),
    });

    const updateResult = await this.bookRepository.update(request.id, book);

    if (updateResult.isSuccess()) {
      const uploadsDir = process.env.UPLOADS_DIRECTORY || './uploads';
      await this.fileProcessingQueue.enqueueMetadataSync(
        request.id,
        updateResult.value.fileName,
        `${uploadsDir}/books/${updateResult.value.fileName}`,
        { jobId: `sync-${request.id}` },
      );
    }

    return updateResult;
  }
}
