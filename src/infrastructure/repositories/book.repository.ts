import { Injectable } from '@nestjs/common';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { Repository } from 'typeorm';
import { BookEntity } from '../database/book.entity';
import { BookMapper } from '../mappers/book.mapper';
import { InjectRepository } from '@nestjs/typeorm';
import { Book } from 'src/domain/entities/book.entity';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { BookNotFoundFailure } from '../../domain/failures/book.failures';
import { Result } from '../../core/result';

@Injectable()
export class TypeOrmBookRepository implements IBookRepository {
  constructor(
    @InjectRepository(BookEntity) private repository: Repository<BookEntity>,
  ) {}

  async create(entity: Book): Promise<Result<Book>> {
    const bookEntity = BookMapper.toPersistence(entity);
    const savedEntity = await this.repository.save(bookEntity);
    return Result.success(BookMapper.toDomain(savedEntity));
  }

  async findAll(): Promise<Result<Book[]>> {
    const bookEntities = await this.repository.find();
    return Result.success(BookMapper.toDomainList(bookEntities));
  }

  async findById(id: string): Promise<Result<Book>> {
    const bookEntity =
      (await this.repository.findOne({ where: { id } })) || null;
    if (bookEntity) return Result.success(BookMapper.toDomain(bookEntity));
    return Result.failure(new BookNotFoundFailure());
  }

  async update(id: string, book: Book): Promise<Result<Book>> {
    const exists = await this.repository.existsBy({ id: id });

    if (!exists) return Result.failure(new BookNotFoundFailure());

    const bookEntity = BookMapper.toPersistence(book);
    await this.repository.save(bookEntity);
    return Result.success(BookMapper.toDomain(bookEntity));
  }

  async delete(id: string): Promise<Result<Book>> {
    const findBookResult = await this.findById(id);
    if (!findBookResult.isSuccess()) {
      return Result.failure(new BookNotFoundFailure());
    }

    const book = findBookResult.getValue();
    if (
      existsSync(
        `${process.env.UPLOADS_DIRECTORY || join(process.cwd(), 'uploads')}/books/${book.fileName}`,
      )
    ) {
      unlinkSync(
        `${process.env.UPLOADS_DIRECTORY || join(process.cwd(), 'uploads')}/books/${book.fileName}`,
      );
    }
    if (
      existsSync(
        `${process.env.UPLOADS_DIRECTORY || join(process.cwd(), 'uploads')}/cover-images/${book.coverImageFileName}`,
      )
    ) {
      unlinkSync(
        `${process.env.UPLOADS_DIRECTORY || join(process.cwd(), 'uploads')}/cover-images/${book.coverImageFileName}`,
      );
    }
    await this.repository.delete(id);
    return Result.success(book);
  }

  async findByAuthor(author: string): Promise<Result<Book[]>> {
    const bookEntities = await this.repository.find({ where: { author } });
    return Result.success(BookMapper.toDomainList(bookEntities));
  }

  async findFavorites(): Promise<Result<Book[]>> {
    const bookEntities = await this.repository.find({
      where: { isFavorite: true },
    });
    return Result.success(BookMapper.toDomainList(bookEntities));
  }

  async findByTitle(title: string): Promise<Result<Book>> {
    const bookEntity =
      (await this.repository.findOne({ where: { title } })) || null;
    if (bookEntity) Result.success(BookMapper.toDomain(bookEntity));
    return Result.failure(new BookNotFoundFailure());
  }
}
