import { Inject, Injectable } from '@nestjs/common';
import { Result } from '../../../core/result';
import { UseCase } from '../../../core/usecase';
import { UpdateBookShelfRequest } from '../../contracts/bookshelf/update-book-shelf-request';
import { BookShelf } from '../../../domain/entities/bookshelf.entity';
import { IBookShelfRepository } from '../../interfaces/bookshelf-repository';

@Injectable()
export class UpdateBookShelfUseCase
  implements UseCase<UpdateBookShelfRequest, BookShelf>
{
  constructor(
    @Inject('BookShelfRepository')
    private bookShelfRepository: IBookShelfRepository,
  ) {}

  async execute(request: UpdateBookShelfRequest): Promise<Result<BookShelf>> {
    const findBookResult = await this.bookShelfRepository.findById(request.id);

    if (!findBookResult.isSuccess()) {
      return findBookResult;
    }

    const bookShelf = findBookResult.getValue();

    bookShelf.title = request.title ?? bookShelf.title;

    return await this.bookShelfRepository.update(request.id, bookShelf);
  }
}
