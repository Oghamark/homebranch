import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Result } from 'src/core/result';
import { PaginationResult } from 'src/core/pagination_result';
import { BookShelfEntity } from 'src/infrastructure/database/book-shelf.entity';
import { BookEntity } from 'src/infrastructure/database/book.entity';
import { IBookShelfRepository } from 'src/application/interfaces/bookshelf-repository';
import { BookShelf } from 'src/domain/entities/bookshelf.entity';
import { BookShelfMapper } from '../mappers/book-shelf.mapper';
import { BookShelfNotFoundFailure } from 'src/domain/failures/bookshelf.failures';

@Injectable()
export class TypeOrmBookShelfRepository implements IBookShelfRepository {
  constructor(
    @InjectRepository(BookShelfEntity)
    private repository: Repository<BookShelfEntity>,
    @InjectRepository(BookEntity)
    private bookRepository: Repository<BookEntity>,
  ) {}

  async create(entity: BookShelf): Promise<Result<BookShelf>> {
    const bookShelfEntity = BookShelfMapper.toPersistence(entity);
    const savedEntity = await this.repository.save(bookShelfEntity);
    return Result.success(BookShelfMapper.toDomain(savedEntity));
  }

  async findAll(
    limit?: number,
    offset?: number,
  ): Promise<Result<PaginationResult<BookShelf[]>>> {
    const [bookShelfEntities, total] = await this.repository.findAndCount({
      relations: ['books'],
      take: limit,
      skip: offset,
    });

    return Result.success({
      data: BookShelfMapper.toDomainList(bookShelfEntities),
      limit: limit,
      offset: offset,
      total: total,
      nextCursor:
        limit && total > (offset ?? 0) + limit ? (offset ?? 0) + limit : null,
    });
  }

  async findById(id: string): Promise<Result<BookShelf>> {
    const bookShelfEntity =
      (await this.repository.findOne({
        where: { id },
        relations: ['books'],
      })) || null;
    if (bookShelfEntity) {
      return Result.success(BookShelfMapper.toDomain(bookShelfEntity));
    }
    return Result.failure(new BookShelfNotFoundFailure());
  }

  async update(id: string, bookShelf: BookShelf): Promise<Result<BookShelf>> {
    const currentShelf = await this.repository.findOne({
      where: { id },
      relations: ['books'],
    });

    if (!currentShelf) return Result.failure(new BookShelfNotFoundFailure());

    // Nullify FK on books removed from the shelf
    const newBookIds = new Set(bookShelf.books.map((b) => b.id));
    const removedBookIds = (currentShelf.books ?? [])
      .filter((b) => !newBookIds.has(b.id))
      .map((b) => b.id);

    if (removedBookIds.length > 0) {
      await this.bookRepository
        .createQueryBuilder()
        .update(BookEntity)
        .set({ bookShelf: () => 'NULL' })
        .whereInIds(removedBookIds)
        .execute();
    }

    const bookShelfEntity = BookShelfMapper.toPersistence(bookShelf);
    const savedEntity = await this.repository.save(bookShelfEntity);
    const result = await this.repository.findOne({
      where: { id: savedEntity.id },
      relations: ['books'],
    });
    return Result.success(BookShelfMapper.toDomain(result!));
  }

  async delete(id: string): Promise<Result<BookShelf>> {
    const findBookShelfResult = await this.findById(id);
    if (!findBookShelfResult.isSuccess()) {
      return Result.failure(new BookShelfNotFoundFailure());
    }

    const bookShelf = findBookShelfResult.getValue();
    await this.repository.delete(id);
    return Result.success(bookShelf);
  }

  async findByTitle(title: string): Promise<Result<BookShelf>> {
    const bookShelfEntity =
      (await this.repository.findOne({ where: { title } })) || null;
    if (bookShelfEntity) {
      return Result.success(BookShelfMapper.toDomain(bookShelfEntity));
    }
    return Result.failure(new BookShelfNotFoundFailure());
  }
}
