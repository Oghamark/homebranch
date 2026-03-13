import { Inject, Injectable } from '@nestjs/common';
import { IBookRepository } from '../../interfaces/book-repository';
import { Result } from 'src/core/result';

@Injectable()
export class ToggleBookFavoriteUseCase {
  constructor(@Inject('BookRepository') private bookRepository: IBookRepository) {}

  async execute(userId: string, bookId: string): Promise<Result<{ isFavorite: boolean }>> {
    return this.bookRepository.toggleFavorite(userId, bookId);
  }
}
