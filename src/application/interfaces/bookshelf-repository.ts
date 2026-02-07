import { Result } from '../../core/result';
import { IRepository } from '../../core/repository';
import { BookShelf } from '../../domain/entities/bookshelf.entity';

export interface IBookShelfRepository extends IRepository<BookShelf> {
  findByTitle(title: string): Promise<Result<BookShelf>>;
}
