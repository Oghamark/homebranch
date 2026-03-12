import { Inject, Injectable } from '@nestjs/common';
import { IBookRepository } from '../../interfaces/book-repository';
import { AssignBookOwnerRequest } from '../../contracts/book/assign-book-owner-request';
import { Book } from 'src/domain/entities/book.entity';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { BookNotFoundFailure, DeleteBookForbiddenFailure } from 'src/domain/failures/book.failures';

@Injectable()
export class AssignBookOwnerUseCase implements UseCase<AssignBookOwnerRequest, Book> {
  constructor(@Inject('BookRepository') private bookRepository: IBookRepository) {}

  async execute({ id, ownerId, requestingUserRole }: AssignBookOwnerRequest): Promise<Result<Book>> {
    if (requestingUserRole !== 'ADMIN') {
      return Result.fail(new DeleteBookForbiddenFailure());
    }

    const bookResult = await this.bookRepository.findById(id);
    if (!bookResult.isSuccess()) return Result.fail(new BookNotFoundFailure());

    const book = bookResult.value;
    book.uploadedByUserId = ownerId ?? undefined;

    return await this.bookRepository.update(book.id, book);
  }
}
