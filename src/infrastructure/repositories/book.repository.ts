import { Injectable } from '@nestjs/common';
import { IBookRepository, BookSearchFilters } from 'src/application/interfaces/book-repository';
import { IsNull, Repository } from 'typeorm';
import { BookEntity } from 'src/infrastructure/database/book.entity';
import { UserBookFavoriteEntity } from 'src/infrastructure/database/user-book-favorite.entity';
import { BookMapper } from '../mappers/book.mapper';
import { InjectRepository } from '@nestjs/typeorm';
import { Book } from 'src/domain/entities/book.entity';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import { Result } from 'src/core/result';
import { PaginationResult } from 'src/core/pagination_result';
import { BookShelf } from 'src/domain/entities/bookshelf.entity';

@Injectable()
export class TypeOrmBookRepository implements IBookRepository {
  constructor(
    @InjectRepository(BookEntity) private readonly repository: Repository<BookEntity>,
    @InjectRepository(UserBookFavoriteEntity) private readonly favoriteRepository: Repository<UserBookFavoriteEntity>,
  ) {}

  async create(entity: Book): Promise<Result<Book>> {
    const bookEntity = BookMapper.toPersistence(entity);
    const savedEntity = await this.repository.save(bookEntity);
    return Result.ok(BookMapper.toDomain(savedEntity));
  }

  async findAll(
    limit?: number,
    offset?: number,
    userId?: string,
    viewerUserId?: string,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const [bookEntities, total] = await this.repository.findAndCount({
      where: userId ? { uploadedByUserId: userId } : {},
      order: { author: 'ASC', title: 'ASC' },
      take: limit,
      skip: offset,
    });

    const books = BookMapper.toDomainList(bookEntities);
    if (viewerUserId) {
      await this.applyFavoriteStatus(books, viewerUserId);
    }

    return Result.ok({
      data: books,
      limit: limit,
      offset: offset,
      total: total,
      nextCursor: offset && limit && total > offset + limit ? offset + limit : null,
    });
  }

  async findById(id: string, viewerUserId?: string): Promise<Result<Book>> {
    const bookEntity = (await this.repository.findOne({ where: { id } })) || null;
    if (!bookEntity) return Result.fail(new BookNotFoundFailure());
    const book = BookMapper.toDomain(bookEntity);
    if (viewerUserId) {
      await this.applyFavoriteStatus([book], viewerUserId);
    }
    return Result.ok(book);
  }

  async findByBookShelfId(
    bookShelf: BookShelf,
    limit?: number,
    offset?: number,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const [bookEntities, total] = await this.repository
      .createQueryBuilder('book')
      .innerJoin('book.bookShelves', 'shelf', 'shelf.id = :shelfId', {
        shelfId: bookShelf.id,
      })
      .orderBy('book.author', 'ASC')
      .addOrderBy('book.title', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    return Result.ok({
      data: BookMapper.toDomainList(bookEntities),
      limit: limit,
      offset: offset,
      total: total,
      nextCursor: limit && total > (offset ?? 0) + limit ? (offset ?? 0) + limit : null,
    });
  }

  async update(id: string, book: Book): Promise<Result<Book>> {
    const exists = await this.repository.existsBy({ id: id });

    if (!exists) return Result.fail(new BookNotFoundFailure());

    const bookEntity = BookMapper.toPersistence(book);
    await this.repository.save(bookEntity);
    return Result.ok(BookMapper.toDomain(bookEntity));
  }

  async delete(id: string): Promise<Result<Book>> {
    const findBookResult = await this.findById(id);
    if (!findBookResult.isSuccess()) {
      return Result.fail(new BookNotFoundFailure());
    }

    const book = findBookResult.value;
    if (existsSync(`${process.env.UPLOADS_DIRECTORY || join(process.cwd(), 'uploads')}/books/${book.fileName}`)) {
      unlinkSync(`${process.env.UPLOADS_DIRECTORY || join(process.cwd(), 'uploads')}/books/${book.fileName}`);
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
    return Result.ok(book);
  }

  async findByAuthor(
    author: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const [bookEntities, total] = await this.repository.findAndCount({
      where: userId ? { author, uploadedByUserId: userId } : { author },
      order: { title: 'ASC' },
      take: limit,
      skip: offset,
    });
    return Result.ok({
      data: BookMapper.toDomainList(bookEntities),
      limit: limit,
      offset: offset,
      total: total,
      nextCursor: limit && total > (offset || 0) + (limit || 0) ? (offset || 0) + (limit || 0) : null,
    });
  }

  async findFavorites(limit?: number, offset?: number, userId?: string): Promise<Result<PaginationResult<Book[]>>> {
    const qb = this.repository
      .createQueryBuilder('book')
      .innerJoin('user_book_favorite', 'fav', 'fav.book_id = book.id AND fav.user_id = :userId', { userId });
    const [bookEntities, total] = await qb
      .orderBy('book.author', 'ASC')
      .addOrderBy('book.title', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();
    const books = BookMapper.toDomainList(bookEntities).map((b) => {
      b.isFavorite = true;
      return b;
    });
    return Result.ok({
      data: books,
      limit,
      offset,
      total,
      nextCursor: limit && total > (offset || 0) + (limit || 0) ? (offset || 0) + (limit || 0) : null,
    });
  }

  async findByTitle(title: string): Promise<Result<Book>> {
    const bookEntity = (await this.repository.findOne({ where: { title } })) || null;
    if (bookEntity) return Result.ok(BookMapper.toDomain(bookEntity));
    return Result.fail(new BookNotFoundFailure());
  }

  async searchByTitle(
    title: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const queryBuilder = this.repository
      .createQueryBuilder('book')
      .where('LOWER(book.title) LIKE LOWER(:title)', { title: `%${title}%` });

    if (userId) {
      queryBuilder.andWhere('book.uploadedByUserId = :userId', { userId });
    }

    const [bookEntities, total] = await queryBuilder
      .orderBy('book.author', 'ASC')
      .addOrderBy('book.title', 'ASC')
      .limit(limit)
      .skip(offset)
      .getManyAndCount();

    return Result.ok({
      data: BookMapper.toDomainList(bookEntities),
      limit: limit,
      offset: offset,
      total: total,
      nextCursor: limit && total > (offset || 0) + (limit || 0) ? (offset || 0) + (limit || 0) : null,
    });
  }

  async searchFavoritesByTitle(
    title: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const queryBuilder = this.repository
      .createQueryBuilder('book')
      .innerJoin('user_book_favorite', 'fav', 'fav.book_id = book.id AND fav.user_id = :userId', { userId })
      .where('LOWER(book.title) LIKE LOWER(:title)', { title: `%${title}%` });

    const [bookEntities, total] = await queryBuilder
      .orderBy('book.author', 'ASC')
      .addOrderBy('book.title', 'ASC')
      .limit(limit)
      .skip(offset)
      .getManyAndCount();

    const books = BookMapper.toDomainList(bookEntities).map((b) => {
      b.isFavorite = true;
      return b;
    });
    return Result.ok({
      data: books,
      limit: limit,
      offset: offset,
      total: total,
      nextCursor: limit && total > (offset || 0) + (limit || 0) ? (offset || 0) + (limit || 0) : null,
    });
  }

  async searchByAuthorAndTitle(
    author: string,
    title: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const qb = this.repository
      .createQueryBuilder('book')
      .where('book.author = :author', { author })
      .andWhere('LOWER(book.title) LIKE LOWER(:title)', { title: `%${title}%` });

    if (userId) {
      qb.andWhere('book.uploadedByUserId = :userId', { userId });
    }

    const [bookEntities, total] = await qb.orderBy('book.title', 'ASC').limit(limit).skip(offset).getManyAndCount();

    return Result.ok({
      data: BookMapper.toDomainList(bookEntities),
      limit: limit,
      offset: offset,
      total: total,
      nextCursor: limit && total > (offset || 0) + (limit || 0) ? (offset || 0) + (limit || 0) : null,
    });
  }

  private applySearchFilters(qb: ReturnType<typeof this.repository.createQueryBuilder>, filters: BookSearchFilters) {
    if (filters.query) {
      qb.andWhere('LOWER(book.title) LIKE LOWER(:query)', { query: `%${filters.query}%` });
    }
    if (filters.isbn) {
      qb.andWhere('book.isbn = :isbn', { isbn: filters.isbn });
    }
    if (filters.genre) {
      qb.andWhere('LOWER(book.genres) LIKE LOWER(:genre)', { genre: `%${filters.genre}%` });
    }
    if (filters.series) {
      qb.andWhere('LOWER(book.series) LIKE LOWER(:series)', { series: `%${filters.series}%` });
    }
    if (filters.author) {
      qb.andWhere('LOWER(book.author) LIKE LOWER(:author)', { author: `%${filters.author}%` });
    }
  }

  async searchWithFilters(
    filters: BookSearchFilters,
    limit?: number,
    offset?: number,
    userId?: string,
    viewerUserId?: string,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const qb = this.repository.createQueryBuilder('book');
    this.applySearchFilters(qb, filters);
    if (userId) {
      qb.andWhere('book.uploadedByUserId = :userId', { userId });
    }
    const [bookEntities, total] = await qb
      .orderBy('book.author', 'ASC')
      .addOrderBy('book.title', 'ASC')
      .limit(limit)
      .skip(offset)
      .getManyAndCount();
    const books = BookMapper.toDomainList(bookEntities);
    if (viewerUserId) {
      await this.applyFavoriteStatus(books, viewerUserId);
    }
    return Result.ok({
      data: books,
      limit,
      offset,
      total,
      nextCursor: limit && total > (offset || 0) + limit ? (offset || 0) + limit : null,
    });
  }

  async searchFavoritesWithFilters(
    filters: BookSearchFilters,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const qb = this.repository
      .createQueryBuilder('book')
      .innerJoin('user_book_favorite', 'fav', 'fav.book_id = book.id AND fav.user_id = :userId', { userId });
    this.applySearchFilters(qb, filters);
    const [bookEntities, total] = await qb
      .orderBy('book.author', 'ASC')
      .addOrderBy('book.title', 'ASC')
      .limit(limit)
      .skip(offset)
      .getManyAndCount();
    const books = BookMapper.toDomainList(bookEntities).map((b) => {
      b.isFavorite = true;
      return b;
    });
    return Result.ok({
      data: books,
      limit,
      offset,
      total,
      nextCursor: limit && total > (offset || 0) + limit ? (offset || 0) + limit : null,
    });
  }

  async toggleFavorite(userId: string, bookId: string): Promise<Result<{ isFavorite: boolean }>> {
    const existing = await this.favoriteRepository.findOne({ where: { userId, bookId } });
    if (existing) {
      await this.favoriteRepository.delete({ userId, bookId });
      return Result.ok({ isFavorite: false });
    } else {
      await this.favoriteRepository.save({ userId, bookId });
      return Result.ok({ isFavorite: true });
    }
  }

  private async applyFavoriteStatus(books: Book[], userId: string): Promise<void> {
    if (!books.length) return;
    const bookIds = books.map((b) => b.id);
    const favorites = await this.favoriteRepository
      .createQueryBuilder('fav')
      .where('fav.user_id = :userId', { userId })
      .andWhere('fav.book_id IN (:...bookIds)', { bookIds })
      .getMany();
    const favoriteSet = new Set(favorites.map((f) => f.bookId));
    for (const book of books) {
      book.isFavorite = favoriteSet.has(book.id);
    }
  }

  async findBooksWithoutMetadata(limit: number): Promise<Result<Book[]>> {
    const bookEntities = await this.repository.find({
      where: { metadataFetchedAt: IsNull() },
      take: limit,
      order: { title: 'ASC' },
    });
    return Result.ok(BookMapper.toDomainList(bookEntities));
  }

  async findNewArrivals(limit?: number, offset?: number): Promise<Result<PaginationResult<Book[]>>> {
    const [bookEntities, total] = await this.repository.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return Result.ok({
      data: BookMapper.toDomainList(bookEntities),
      limit,
      offset,
      total,
      nextCursor: limit && total > (offset || 0) + limit ? (offset || 0) + limit : null,
    });
  }
}
