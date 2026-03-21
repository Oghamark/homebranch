import { Injectable } from '@nestjs/common';
import { BookSearchFilters, IBookRepository } from 'src/application/interfaces/book-repository';
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
      where: userId ? { uploadedByUserId: userId, deletedAt: IsNull() } : { deletedAt: IsNull() },
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
    const bookEntity = (await this.repository.findOne({ where: { id, deletedAt: IsNull() } })) || null;
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
      .where('book.deletedAt IS NULL')
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
    return this.softDelete(id);
  }

  async permanentDelete(id: string): Promise<Result<Book>> {
    const bookEntity = await this.repository.findOne({ where: { id } });
    if (!bookEntity) return Result.fail(new BookNotFoundFailure());

    const book = BookMapper.toDomain(bookEntity);
    const uploadsDir = process.env.UPLOADS_DIRECTORY || join(process.cwd(), 'uploads');
    if (existsSync(join(uploadsDir, 'books', book.fileName))) {
      unlinkSync(join(uploadsDir, 'books', book.fileName));
    }
    if (book.coverImageFileName && existsSync(join(uploadsDir, 'cover-images', book.coverImageFileName))) {
      unlinkSync(join(uploadsDir, 'cover-images', book.coverImageFileName));
    }
    await this.repository.delete(id);
    return Result.ok(book);
  }

  async softDelete(id: string): Promise<Result<Book>> {
    const bookEntity = await this.repository.findOne({ where: { id, deletedAt: IsNull() } });
    if (!bookEntity) return Result.fail(new BookNotFoundFailure());

    bookEntity.deletedAt = new Date();
    await this.repository.save(bookEntity);
    return Result.ok(BookMapper.toDomain(bookEntity));
  }

  async restore(id: string): Promise<Result<Book>> {
    const bookEntity = await this.repository.findOne({ where: { id } });
    if (!bookEntity) return Result.fail(new BookNotFoundFailure());

    // Must use null (not undefined) — TypeORM omits undefined fields from the UPDATE,
    // leaving deleted_at unchanged in the database.
    bookEntity.deletedAt = null as unknown as undefined;
    await this.repository.save(bookEntity);
    return Result.ok(BookMapper.toDomain(bookEntity));
  }

  async findByFileName(fileName: string, includeDeleted = false): Promise<Result<Book>> {
    const where = includeDeleted ? { fileName } : { fileName, deletedAt: IsNull() };
    const bookEntity = await this.repository.findOne({ where });
    if (bookEntity) return Result.ok(BookMapper.toDomain(bookEntity));
    return Result.fail(new BookNotFoundFailure());
  }

  async findByContentHash(hash: string, includeDeleted = false): Promise<Result<Book>> {
    const where = includeDeleted ? { fileContentHash: hash } : { fileContentHash: hash, deletedAt: IsNull() };
    const bookEntity = await this.repository.findOne({ where });
    if (bookEntity) return Result.ok(BookMapper.toDomain(bookEntity));
    return Result.fail(new BookNotFoundFailure());
  }

  async findAllActive(): Promise<Result<Book[]>> {
    const bookEntities = await this.repository.find({ where: { deletedAt: IsNull() } });
    return Result.ok(BookMapper.toDomainList(bookEntities));
  }

  async updateContentHash(id: string, hash: string): Promise<Result<void>> {
    await this.repository.update({ id }, { fileContentHash: hash });
    return Result.ok(undefined);
  }

  async findUnowned(limit?: number, offset?: number): Promise<Result<PaginationResult<Book[]>>> {
    const [bookEntities, total] = await this.repository.findAndCount({
      where: { uploadedByUserId: IsNull(), deletedAt: IsNull() },
      order: { title: 'ASC' },
      take: limit,
      skip: offset,
    });
    return Result.ok({
      data: BookMapper.toDomainList(bookEntities),
      limit,
      offset,
      total,
      nextCursor: null,
    });
  }

  async findOrphaned(
    knownUserIds: string[],
    limit?: number,
    offset?: number,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const qb = this.repository
      .createQueryBuilder('book')
      .where('book.deletedAt IS NULL')
      .andWhere('book.uploadedByUserId IS NOT NULL');

    if (knownUserIds.length > 0) {
      qb.andWhere('book.uploadedByUserId NOT IN (:...knownUserIds)', { knownUserIds });
    }

    qb.orderBy('book.title', 'ASC');

    const total = await qb.getCount();
    if (limit !== undefined) qb.take(limit);
    if (offset !== undefined) qb.skip(offset);

    const bookEntities = await qb.getMany();
    return Result.ok({
      data: BookMapper.toDomainList(bookEntities),
      limit,
      offset,
      total,
      nextCursor: null,
    });
  }

  async findByAuthor(
    author: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<Result<PaginationResult<Book[]>>> {
    const [bookEntities, total] = await this.repository.findAndCount({
      where: userId ? { author, uploadedByUserId: userId, deletedAt: IsNull() } : { author, deletedAt: IsNull() },
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
      .where('book.deletedAt IS NULL')
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
    const bookEntity = (await this.repository.findOne({ where: { title, deletedAt: IsNull() } })) || null;
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
      .where('LOWER(book.title) LIKE LOWER(:title)', { title: `%${title}%` })
      .andWhere('book.deletedAt IS NULL');

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
      .where('LOWER(book.title) LIKE LOWER(:title)', { title: `%${title}%` })
      .andWhere('book.isFavorite = true')
      .andWhere('book.deletedAt IS NULL');

    if (userId) {
      queryBuilder.andWhere('book.uploadedByUserId = :userId', { userId });
    }

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
      .andWhere('LOWER(book.title) LIKE LOWER(:title)', { title: `%${title}%` })
      .andWhere('book.deletedAt IS NULL');

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
    const qb = this.repository.createQueryBuilder('book').where('book.deletedAt IS NULL');
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
      .where('book.isFavorite = true')
      .andWhere('book.deletedAt IS NULL')
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
      where: { metadataFetchedAt: IsNull(), deletedAt: IsNull() },
      take: limit,
      order: { title: 'ASC' },
    });
    return Result.ok(BookMapper.toDomainList(bookEntities));
  }

  async findNewArrivals(limit?: number, offset?: number): Promise<Result<PaginationResult<Book[]>>> {
    const [bookEntities, total] = await this.repository.findAndCount({
      where: { deletedAt: IsNull() },
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
