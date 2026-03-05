import { Book } from 'src/domain/entities/book.entity';
import { UpdateBookRequest } from '../../contracts/book/update-book-request';
import { IBookRepository } from '../../interfaces/book-repository';
import { Inject, Injectable } from '@nestjs/common';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { BookFactory } from 'src/domain/entities/book.factory';

@Injectable()
export class UpdateBookUseCase implements UseCase<UpdateBookRequest, Book> {
  constructor(@Inject('BookRepository') private bookRepository: IBookRepository) {}

  async execute(request: UpdateBookRequest): Promise<Result<Book>> {
    const findBookResult = await this.bookRepository.findById(request.id);
    if (!findBookResult.isSuccess()) {
      return findBookResult;
    }

    const book = BookFactory.reconstitute(findBookResult.value, request);

    return await this.bookRepository.update(request.id, book);
  }
}
