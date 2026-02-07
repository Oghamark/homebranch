import { Inject, Injectable } from '@nestjs/common';
import { Result } from '../../../core/result';
import { DeleteBookShelfRequest } from '../../contracts/bookshelf/delete-book-shelf-request';
import { BookShelf } from '../../../domain/entities/bookshelf.entity';
import { IBookShelfRepository } from '../../interfaces/bookshelf-repository';
import { UseCase } from '../../../core/usecase';

@Injectable()
export class DeleteBookShelfUseCase
  implements UseCase<DeleteBookShelfRequest, BookShelf>
{
  constructor(
    @Inject('BookShelfRepository')
    private bookShelfRepository: IBookShelfRepository,
  ) {}

  async execute({ id }: DeleteBookShelfRequest): Promise<Result<BookShelf>> {
    return await this.bookShelfRepository.delete(id);
  }
}
