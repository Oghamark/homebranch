import { Inject, Injectable, Logger } from '@nestjs/common';
import { BookSearchFilters, IBookRepository } from 'src/application/interfaces/book-repository';
import { In, IsNull, Repository } from 'typeorm';
import { BookEntity } from 'src/infrastructure/database/book.entity';
import { UserBookFavoriteEntity } from 'src/infrastructure/database/user-book-favorite.entity';
import { BookMapper } from '../mappers/book.mapper';
import { InjectRepository } from '@nestjs/typeorm';
import { Book } from 'src/domain/entities/book.entity';
import { BookFormatEntity } from 'src/infrastructure/database/book-format.entity';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import { Result } from 'src/core/result';
import { PaginationResult } from 'src/core/pagination_result';
import { BookShelf } from 'src/domain/entities/bookshelf.entity';
import { BookFormatProcessingService } from 'src/infrastructure/services/book-format-processing.service';
import { IFileService } from 'src/application/interfaces/file-service';
import { BookFileMetadata } from 'src/application/interfaces/book-metadata-parser';
import { buildBookFormatMetadata, hasStoredFormatMetadata } from 'src/domain/services/book-format-metadata';

@Injectable()
export class TypeOrmBookRepository implements IBookRepository {
  private readonly logger = new Logger(TypeOrmBookRepository.name);

  constructor(
    @InjectRepository(BookEntity) private readonly repository: Repository<BookEntity>,
    @InjectRepository(BookFormatEntity) private readonly formatRepository: Repository<BookFormatEntity>,
    @InjectRepository(UserBookFavoriteEntity) private readonly favoriteRepository: Repository<UserBookFavoriteEntity>,
    @Inject('FileService') private readonly fileService: IFileService,
    private readonly bookFormatProcessingService: BookFormatProcessingService,
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
    const bookEntity =
      (await this.repository.findOne({
        where: { id, deletedAt: IsNull() },
        relations: { formats: true },
      })) || null;
    if (!bookEntity) return Result.fail(new BookNotFoundFailure());
    const hydratedEntity = await this.hydrateFormatMetadata(bookEntity);
    const book = BookMapper.toDomain(hydratedEntity);
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
    const existing = await this.repository.findOne({
      where: { id },
      relations: { formats: true },
    });

    if (!existing) return Result.fail(new BookNotFoundFailure());

    const persistence = BookMapper.toPersistence(book);
    this.applyPersistence(existing, persistence);

    await this.repository.manager.transaction(async (manager) => {
      await this.saveBookWithFormats(manager, existing, persistence);
    });

    return this.findPersistedBook(id);
  }

  async splitFormat(bookId: string, updatedBook: Book, splitBook: Book): Promise<Result<Book>> {
    const existing = await this.repository.findOne({
      where: { id: bookId },
      relations: { formats: true },
    });

    if (!existing) return Result.fail(new BookNotFoundFailure());

    const updatedPersistence = BookMapper.toPersistence(updatedBook);
    const splitPersistence = BookMapper.toPersistence(splitBook);

    this.applyPersistence(existing, updatedPersistence);

    await this.repository.manager.transaction(async (manager) => {
      await this.saveBookWithFormats(manager, existing, updatedPersistence);
      await manager.getRepository(BookEntity).save(splitPersistence);
    });

    return this.findPersistedBook(bookId);
  }

  async delete(id: string): Promise<Result<Book>> {
    return this.softDelete(id);
  }

  async permanentDelete(id: string): Promise<Result<Book>> {
    const bookEntity = await this.repository.findOne({ where: { id }, relations: { formats: true } });
    if (!bookEntity) return Result.fail(new BookNotFoundFailure());

    const book = BookMapper.toDomain(bookEntity);
    const uploadsDir = process.env.UPLOADS_DIRECTORY || join(process.cwd(), 'uploads');
    const fileNames = new Set(book.formats?.map((format) => format.fileName) ?? [book.fileName]);
    for (const fileName of fileNames) {
      if (existsSync(join(uploadsDir, 'books', fileName))) {
        unlinkSync(join(uploadsDir, 'books', fileName));
      }
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
    const qb = this.repository
      .createQueryBuilder('book')
      .leftJoinAndSelect('book.formats', 'format')
      .where('(book.file_name = :fileName OR format.file_name = :fileName)', { fileName });
    if (!includeDeleted) {
      qb.andWhere('book.deletedAt IS NULL');
    }
    const bookEntity = await qb.getOne();
    if (bookEntity) return Result.ok(BookMapper.toDomain(bookEntity));
    return Result.fail(new BookNotFoundFailure());
  }

  async findByContentHash(hash: string, includeDeleted = false): Promise<Result<Book>> {
    const qb = this.repository
      .createQueryBuilder('book')
      .leftJoinAndSelect('book.formats', 'format')
      .where('(book.file_content_hash = :hash OR format.file_content_hash = :hash)', { hash });
    if (!includeDeleted) {
      qb.andWhere('book.deletedAt IS NULL');
    }
    const bookEntity = await qb.getOne();
    if (bookEntity) return Result.ok(BookMapper.toDomain(bookEntity));
    return Result.fail(new BookNotFoundFailure());
  }

  async findAllActive(): Promise<Result<Book[]>> {
    const bookEntities = await this.repository.find({ where: { deletedAt: IsNull() }, relations: { formats: true } });
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

  private applyPersistence(existing: BookEntity, persistence: BookEntity): void {
    existing.title = persistence.title;
    existing.author = persistence.author;
    existing.fileName = persistence.fileName;
    existing.isFavorite = persistence.isFavorite;
    existing.genres = persistence.genres;
    existing.publishedYear = persistence.publishedYear;
    existing.coverImageFileName = persistence.coverImageFileName;
    existing.summary = persistence.summary;
    existing.uploadedByUserId = persistence.uploadedByUserId;
    existing.series = persistence.series;
    existing.seriesPosition = persistence.seriesPosition;
    existing.isbn = persistence.isbn;
    existing.pageCount = persistence.pageCount;
    existing.publisher = persistence.publisher;
    existing.language = persistence.language;
    existing.averageRating = persistence.averageRating;
    existing.ratingsCount = persistence.ratingsCount;
    existing.metadataFetchedAt = persistence.metadataFetchedAt;
    existing.lastSyncedAt = persistence.lastSyncedAt;
    existing.syncedMetadata = persistence.syncedMetadata;
    existing.fileMtime = persistence.fileMtime;
    existing.fileContentHash = persistence.fileContentHash;
    existing.metadataUpdatedAt = persistence.metadataUpdatedAt;
    existing.deletedAt = persistence.deletedAt;
  }

  private async saveBookWithFormats(
    manager: Repository<BookEntity>['manager'],
    existing: BookEntity,
    persistence: BookEntity,
  ): Promise<void> {
    const bookRepository = manager.getRepository(BookEntity);
    const formatRepository = manager.getRepository(BookFormatEntity);

    await bookRepository.save(existing);

    if (persistence.formats === undefined) {
      return;
    }

    const nextFormats = persistence.formats.map((format) => {
      format.bookId = existing.id;
      return format;
    });
    const nextFormatIds = new Set(nextFormats.map((format) => format.id));
    const removedFormatIds = (existing.formats ?? [])
      .filter((format) => !nextFormatIds.has(format.id))
      .map((format) => format.id);

    if (removedFormatIds.length > 0) {
      await formatRepository.delete({ id: In(removedFormatIds) });
    }

    if (nextFormats.length > 0) {
      await formatRepository.save(nextFormats);
    }
  }

  private async findPersistedBook(id: string): Promise<Result<Book>> {
    const updated = await this.repository.findOne({
      where: { id },
      relations: { formats: true },
    });

    if (!updated) return Result.fail(new BookNotFoundFailure());
    return Result.ok(BookMapper.toDomain(await this.hydrateFormatMetadata(updated)));
  }

  private async hydrateFormatMetadata(bookEntity: BookEntity): Promise<BookEntity> {
    const formats = bookEntity.formats ?? [];
    const missingFormats = formats.filter((format) => !hasStoredFormatMetadata(format));
    if (missingFormats.length === 0) {
      return bookEntity;
    }

    let hasUpdates = false;

    for (const format of missingFormats) {
      const parsedMetadata = await this.parseStoredFormatMetadata(format);
      const coverImageFileName = format.coverImageFileName ?? (await this.extractCoverImage(parsedMetadata));
      const metadata = buildBookFormatMetadata(parsedMetadata, format.fileName, coverImageFileName);

      format.title = metadata.title ?? bookEntity.title;
      format.author = metadata.author ?? bookEntity.author;
      format.genres = metadata.genres;
      format.publishedYear = metadata.publishedYear;
      format.coverImageFileName = metadata.coverImageFileName;
      format.summary = metadata.summary;
      format.series = metadata.series;
      format.seriesPosition = metadata.seriesPosition;
      format.isbn = metadata.isbn;
      format.pageCount = metadata.pageCount;
      format.publisher = metadata.publisher;
      format.language = metadata.language;
      hasUpdates = true;
    }

    if (!hasUpdates) {
      return bookEntity;
    }

    await this.formatRepository.save(missingFormats);
    return (
      (await this.repository.findOne({
        where: { id: bookEntity.id },
        relations: { formats: true },
      })) ?? bookEntity
    );
  }

  private async parseStoredFormatMetadata(format: BookFormatEntity): Promise<BookFileMetadata> {
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    const filePath = join(uploadsDirectory, 'books', format.fileName);

    try {
      return await this.bookFormatProcessingService.parseMetadata(filePath, format.format);
    } catch (error) {
      this.logger.warn(`Could not parse metadata for format "${format.fileName}": ${String(error)}`);
      return {};
    }
  }

  private async extractCoverImage(fileMetadata: BookFileMetadata): Promise<string | undefined> {
    if (!fileMetadata.coverImageBuffer) {
      return undefined;
    }

    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    const coverImageFileName = `${randomUUID()}.jpg`;
    await this.fileService.writeFile(
      join(uploadsDirectory, 'cover-images', coverImageFileName),
      fileMetadata.coverImageBuffer,
    );
    return coverImageFileName;
  }
}
