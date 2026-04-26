import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { statSync, existsSync, renameSync } from 'fs';
import { join, basename, extname } from 'path';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { BookFileMetadata } from 'src/application/interfaces/book-metadata-parser';
import { IContentHashService } from 'src/application/interfaces/content-hash-service';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';
import { ISettingRepository } from 'src/application/interfaces/setting-repository';
import { Result } from 'src/core/result';
import { BookFactory } from 'src/domain/entities/book.factory';
import { Book } from 'src/domain/entities/book.entity';
import { BookFormat, BookFormatProps } from 'src/domain/entities/book-format.entity';
import {
  detectBookFormatFromFileName,
  getAvailableBookFormatsFromBook,
  getBookFormatByFileName,
  getPreferredBookFormat,
} from 'src/domain/services/book-format';
import {
  buildBookFormatMetadata,
  cloneBookFormat,
  withBookMetadataFallback,
} from 'src/domain/services/book-format-metadata';
import { fillBookMetadataFromFileName } from 'src/domain/services/book-file-metadata';
import { SyncableMetadata, SyncableMetadataHelper } from 'src/domain/value-objects/syncable-metadata';
import { logicalBookMatches } from 'src/domain/services/book-deduplication.service';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import { MetadataMerger } from 'src/domain/services/metadata-merger';
import { LibraryEventsService } from 'src/infrastructure/services/library-events.service';
import { BookFormatProcessingService } from 'src/infrastructure/services/book-format-processing.service';

@Processor('file-processing')
export class FileProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(FileProcessingProcessor.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('ContentHashService') private readonly contentHashService: IContentHashService,
    @Inject('MetadataGateway') private readonly metadataGateway: IMetadataGateway,
    @Inject('SettingRepository') private readonly settingRepository: ISettingRepository,
    private readonly libraryEventsService: LibraryEventsService,
    private readonly bookFormatProcessingService: BookFormatProcessingService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'process-new-file':
        await this.processNewFile(job as Job<{ fileName: string; filePath: string }>);
        break;
      case 'sync-metadata':
        await this.syncMetadata(job as Job<{ bookId: string; fileName: string; filePath: string }>);
        break;
      case 'soft-delete-book':
        await this.softDeleteBook(job as Job<{ bookId: string; fileName: string }>);
        break;
      case 'rename-legacy-file':
        await this.renameLegacyFile(job as Job<{ bookId: string; currentFileName: string; newFileName: string }>);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async processNewFile(job: Job<{ fileName: string; filePath: string }>) {
    const { fileName, filePath } = job.data;
    this.logger.log(`Processing new file: ${fileName}`);
    const detectedFormat = detectBookFormatFromFileName(fileName);
    if (!detectedFormat) {
      this.logger.warn(`Unsupported file format for "${fileName}"`);
      await job.updateProgress(100);
      return;
    }
    await job.updateProgress(10);

    const contentHash = await this.contentHashService.computeHash(filePath);
    await job.updateProgress(30);

    // Check for soft-deleted book with same filename
    const byNameResult = await this.bookRepository.findByFileName(fileName, true);
    if (byNameResult.isSuccess() && byNameResult.value.deletedAt) {
      this.logger.log(`Restoring soft-deleted book by filename: "${byNameResult.value.title}"`);
      await this.bookRepository.restore(byNameResult.value.id);
      await this.updateBookFileMetadata(byNameResult.value.id, fileName, filePath, contentHash);
      await this.performMetadataSync(byNameResult.value.id, filePath, fileName);
      this.libraryEventsService.emit({ type: 'book-added', bookId: byNameResult.value.id });
      await job.updateProgress(100);
      return;
    }

    // Check for soft-deleted book with same content hash
    const byHashResult = await this.bookRepository.findByContentHash(contentHash, true);
    if (byHashResult.isSuccess() && byHashResult.value.deletedAt) {
      this.logger.log(
        `Restoring soft-deleted book by content hash: "${byHashResult.value.title}" (was "${byHashResult.value.fileName}")`,
      );
      const stat = statSync(filePath);
      const restoredFormat = withBookMetadataFallback(
        new BookFormat({
          id: randomUUID(),
          format: detectedFormat,
          fileName,
          fileMtime: stat.mtimeMs,
          fileContentHash: contentHash,
        }),
        byHashResult.value,
      );
      const book = this.withUpsertedFormat(byHashResult.value, restoredFormat, { deletedAt: undefined });
      await this.bookRepository.update(byHashResult.value.id, book);
      await this.bookRepository.restore(byHashResult.value.id);
      await this.updateBookFileMetadata(byHashResult.value.id, fileName, filePath, contentHash);
      this.libraryEventsService.emit({ type: 'book-added', bookId: byHashResult.value.id });
      await job.updateProgress(100);
      return;
    }

    // Already exists and active — check if file content changed
    if (byNameResult.isSuccess() && !byNameResult.value.deletedAt) {
      const existingBook = byNameResult.value;
      const existingFormat = getBookFormatByFileName(existingBook, fileName);
      if (existingFormat?.fileContentHash !== contentHash) {
        this.logger.log(`File content changed for existing book "${existingBook.title}", syncing metadata`);
        await this.performMetadataSync(existingBook.id, filePath, fileName);
      } else {
        this.logger.debug(`Book already exists and unchanged: ${fileName}`);
      }
      await job.updateProgress(100);
      return;
    }

    // New book or new format — parse file metadata
    await job.updateProgress(40);
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';

    const fileMetadata = await this.parseBookFileMetadata(filePath, fileName);
    const seededFileMetadata = fillBookMetadataFromFileName({ ...fileMetadata }, fileName);
    const title = seededFileMetadata.title ?? basename(fileName, extname(fileName));
    const author = seededFileMetadata.author ?? 'Unknown Author';

    await job.updateProgress(60);

    // Extract and save cover image
    let coverImageFileName: string | undefined;
    if (fileMetadata.coverImageBuffer) {
      coverImageFileName = `${randomUUID()}.jpg`;
      const coverPath = join(uploadsDirectory, 'cover-images', coverImageFileName);
      await writeFile(coverPath, fileMetadata.coverImageBuffer);
    }

    const stat = statSync(filePath);
    const formatMetadata = {
      ...buildBookFormatMetadata(fileMetadata, fileName, coverImageFileName),
      title,
      author,
    };
    const newFormat = new BookFormat({
      id: randomUUID(),
      format: detectedFormat,
      fileName,
      fileMtime: stat.mtimeMs,
      fileContentHash: contentHash,
      ...formatMetadata,
    });
    const id = randomUUID();
    const syncSnapshot = SyncableMetadataHelper.fromBook({
      title,
      author,
      language: formatMetadata.language,
      publisher: formatMetadata.publisher,
      publishedYear: formatMetadata.publishedYear,
      isbn: formatMetadata.isbn,
      summary: formatMetadata.summary,
      genres: formatMetadata.genres,
      series: formatMetadata.series,
      seriesPosition: formatMetadata.seriesPosition,
    }) as unknown as Record<string, unknown>;

    const defaultOwnerId = await this.getDefaultScanUserId();

    const matchingBook = await this.findMatchingBook(title, author, fileMetadata.isbn);
    if (matchingBook.isSuccess()) {
      const existingBook = matchingBook.value;
      const formatExists = getAvailableBookFormatsFromBook(existingBook).some(
        (format) => format.format === detectedFormat,
      );
      if (!formatExists) {
        const updatedBook = this.withUpsertedFormat(existingBook, newFormat, {
          coverImageFileName: existingBook.coverImageFileName ?? coverImageFileName,
          summary: existingBook.summary ?? formatMetadata.summary,
          genres: existingBook.genres?.length ? existingBook.genres : formatMetadata.genres,
          publishedYear: existingBook.publishedYear ?? formatMetadata.publishedYear,
          uploadedByUserId: existingBook.uploadedByUserId ?? defaultOwnerId,
          series: existingBook.series ?? formatMetadata.series,
          seriesPosition: existingBook.seriesPosition ?? formatMetadata.seriesPosition,
          isbn: existingBook.isbn ?? formatMetadata.isbn,
          pageCount: existingBook.pageCount ?? formatMetadata.pageCount,
          publisher: existingBook.publisher ?? formatMetadata.publisher,
          language: existingBook.language ?? formatMetadata.language,
          syncedMetadata: syncSnapshot,
          lastSyncedAt: new Date(),
        });
        await this.bookRepository.update(existingBook.id, updatedBook);
        this.logger.log(`Attached ${detectedFormat} format to existing book "${existingBook.title}"`);
        this.libraryEventsService.emit({ type: 'book-updated', bookId: existingBook.id });
      }
      await job.updateProgress(100);
      return;
    }

    const book = BookFactory.create(
      id,
      title,
      author,
      fileName,
      false, // isFavorite
      formatMetadata.genres || [],
      formatMetadata.publishedYear,
      coverImageFileName,
      formatMetadata.summary,
      defaultOwnerId, // uploadedByUserId — use default scan user if configured
      formatMetadata.series,
      formatMetadata.seriesPosition,
      formatMetadata.isbn,
      formatMetadata.pageCount,
      formatMetadata.publisher,
      formatMetadata.language,
      undefined, // averageRating
      undefined, // ratingsCount
      undefined, // metadataFetchedAt
      undefined, // createdAt
      undefined, // deletedAt
      new Date(), // lastSyncedAt
      syncSnapshot,
      stat.mtimeMs,
      contentHash,
      undefined, // metadataUpdatedAt
      [newFormat],
    );

    await job.updateProgress(80);

    const createResult = await this.bookRepository.create(book);
    if (createResult.isSuccess()) {
      this.logger.log(`Created book from scan: "${title}" by ${author}`);
      this.libraryEventsService.emit({ type: 'book-added', bookId: createResult.value.id });

      void this.metadataGateway
        .enrichBook(createResult.value)
        .then((enriched) => this.bookRepository.update(enriched.id, enriched))
        .then(() => {
          this.libraryEventsService.emit({ type: 'book-updated', bookId: createResult.value.id });
        })
        .catch((err: unknown) => {
          this.logger.warn(`Background metadata fetch failed for "${title}": ${String(err)}`);
        });
    }

    await job.updateProgress(100);
  }

  private async updateBookFileMetadata(bookId: string, fileName: string, filePath: string, contentHash: string) {
    const stat = statSync(filePath);
    const bookResult = await this.bookRepository.findById(bookId);
    if (bookResult.isSuccess()) {
      const book = this.withUpdatedFormatState(bookResult.value, fileName, {
        fileMtime: stat.mtimeMs,
        fileContentHash: contentHash,
        lastSyncedAt: new Date(),
      });
      await this.bookRepository.update(bookId, book);
    }
  }

  private async syncMetadata(job: Job<{ bookId: string; fileName: string; filePath: string }>) {
    const { bookId, filePath } = job.data;
    this.logger.log(`Syncing metadata for book ${bookId}`);
    await job.updateProgress(10);
    await this.performMetadataSync(bookId, filePath, job.data.fileName);
    await job.updateProgress(100);
  }

  private async performMetadataSync(bookId: string, filePath: string, fileName: string): Promise<void> {
    const bookResult = await this.bookRepository.findById(bookId);
    if (!bookResult.isSuccess()) {
      this.logger.warn(`Book ${bookId} not found for sync`);
      return;
    }

    const book = bookResult.value;
    const detectedFormat = detectBookFormatFromFileName(fileName);
    if (!detectedFormat) {
      this.logger.warn(`Unsupported format for sync: ${fileName}`);
      return;
    }

    let fileMetadata: SyncableMetadata;
    try {
      const parsedMetadata = await this.parseBookFileMetadata(filePath, fileName);
      fileMetadata = SyncableMetadataHelper.fromBook({
        title: parsedMetadata.title || book.title,
        author: parsedMetadata.author || book.author,
        language: parsedMetadata.language,
        publisher: parsedMetadata.publisher,
        publishedYear: parsedMetadata.publishedYear,
        isbn: parsedMetadata.isbn,
        summary: parsedMetadata.summary,
        genres: parsedMetadata.genres,
        series: parsedMetadata.series,
        seriesPosition: parsedMetadata.seriesPosition,
      });
    } catch (err) {
      this.logger.warn(`Cannot parse file for sync: ${String(err)}`);
      return;
    }

    const dbMetadata = SyncableMetadataHelper.fromBook(book);
    const lastSynced = (book.syncedMetadata as unknown as SyncableMetadata) || null;
    const mergeResult = MetadataMerger.merge(fileMetadata, dbMetadata, lastSynced, this.logger);

    const stat = statSync(filePath);
    let finalMtime = stat.mtimeMs;
    let finalHash = await this.contentHashService.computeHash(filePath);

    if (mergeResult.fileUpdated && this.bookFormatProcessingService.canWriteMetadata(detectedFormat)) {
      try {
        await this.bookFormatProcessingService.writeMetadata(filePath, detectedFormat, mergeResult.merged);

        // Recompute hash and stat after writing since the file changed
        const postWriteStat = statSync(filePath);
        finalMtime = postWriteStat.mtimeMs;
        finalHash = await this.contentHashService.computeHash(filePath);
        this.logger.log(`Updated file metadata for "${book.title}"`);
      } catch (err) {
        this.logger.error(`Failed to write metadata to file: ${String(err)}`);
      }
    }

    if (mergeResult.dbUpdated || mergeResult.fileUpdated) {
      // Always spread mergeResult.merged so that dbUpdated field changes are not
      // overwritten when fileUpdated also triggers a DB save.
      const updatedBook = BookFactory.reconstitute(book, {
        ...mergeResult.merged,
        lastSyncedAt: new Date(),
        syncedMetadata: mergeResult.merged as unknown as Record<string, unknown>,
      });
      await this.bookRepository.update(
        bookId,
        this.withUpdatedFormatState(updatedBook, fileName, {
          fileMtime: finalMtime,
          fileContentHash: finalHash,
        }),
      );
      if (mergeResult.dbUpdated) this.logger.log(`Updated DB metadata for "${book.title}"`);
      this.libraryEventsService.emit({ type: 'book-updated', bookId });
    } else {
      // No metadata changes — still update file-tracking fields so the periodic
      // scan does not re-trigger sync indefinitely.
      const updatedBook = this.withUpdatedFormatState(book, fileName, {
        lastSyncedAt: new Date(),
        fileMtime: finalMtime,
        fileContentHash: finalHash,
      });
      await this.bookRepository.update(bookId, updatedBook);
    }
  }

  private async softDeleteBook(job: Job<{ bookId: string; fileName: string }>) {
    const { bookId, fileName } = job.data;
    this.logger.log(`Soft-deleting book ${bookId} (file "${fileName}" removed)`);

    const bookResult = await this.bookRepository.findById(bookId);
    if (!bookResult.isSuccess()) return;

    const remainingFormats = getAvailableBookFormatsFromBook(bookResult.value).filter(
      (format) => format.fileName !== fileName,
    );
    if (remainingFormats.length === 0) {
      const result = await this.bookRepository.softDelete(bookId);
      if (result.isSuccess()) {
        this.logger.log(`Soft-deleted book "${result.value.title}"`);
        this.libraryEventsService.emit({ type: 'book-removed', bookId });
      }
      await job.updateProgress(100);
      return;
    }

    const preferredFormat = getPreferredBookFormat(remainingFormats);
    const updatedBook = BookFactory.reconstitute(bookResult.value, {
      fileName: preferredFormat?.fileName ?? bookResult.value.fileName,
      fileMtime: preferredFormat?.fileMtime ?? bookResult.value.fileMtime,
      fileContentHash: preferredFormat?.fileContentHash ?? bookResult.value.fileContentHash,
      formats: remainingFormats,
    });
    await this.bookRepository.update(bookId, updatedBook);
    this.libraryEventsService.emit({ type: 'book-updated', bookId });
    await job.updateProgress(100);
  }

  private async renameLegacyFile(job: Job<{ bookId: string; currentFileName: string; newFileName: string }>) {
    const { bookId, currentFileName, newFileName } = job.data;
    this.logger.log(`Renaming legacy file: ${currentFileName} → ${newFileName}`);

    const uploadsDir = process.env.UPLOADS_DIRECTORY || './uploads';
    const currentPath = join(uploadsDir, 'books', basename(currentFileName));
    const newPath = join(uploadsDir, 'books', basename(newFileName));

    if (!existsSync(currentPath)) {
      this.logger.warn(`Source file not found: ${currentPath}`);
      return;
    }

    if (existsSync(newPath)) {
      this.logger.warn(`Target file already exists: ${newPath}`);
      return;
    }

    try {
      renameSync(currentPath, newPath);

      const bookResult = await this.bookRepository.findById(bookId);
      if (bookResult.isSuccess()) {
        const matchingFormat = getBookFormatByFileName(bookResult.value, currentFileName);
        const updatedFormats = getAvailableBookFormatsFromBook(bookResult.value).map((format) =>
          format.fileName === currentFileName ? cloneBookFormat(format, { fileName: newFileName }) : format,
        );
        const preferredFormat = getPreferredBookFormat(updatedFormats);
        const updatedBook = BookFactory.reconstitute(bookResult.value, {
          fileName:
            bookResult.value.fileName === currentFileName
              ? newFileName
              : (preferredFormat?.fileName ?? bookResult.value.fileName),
          formats: matchingFormat ? updatedFormats : bookResult.value.formats,
        });
        await this.bookRepository.update(bookId, updatedBook);
        this.logger.log(`Renamed: ${currentFileName} → ${newFileName}`);
      } else {
        // Rollback rename if DB update fails
        renameSync(newPath, currentPath);
        this.logger.error(`DB update failed, rolled back rename for ${currentFileName}`);
      }
    } catch (error) {
      this.logger.error(`Failed to rename ${currentFileName}: ${String(error)}`);
    }

    await job.updateProgress(100);
  }

  private async getDefaultScanUserId(): Promise<string | undefined> {
    const result = await this.settingRepository.findByKey('default_scan_user_id');
    if (result.isSuccess() && result.value.value?.trim()) {
      return result.value.value.trim();
    }
    return undefined;
  }

  private async parseBookFileMetadata(filePath: string, fileName: string): Promise<BookFileMetadata> {
    const detectedFormat = detectBookFormatFromFileName(fileName);
    if (!detectedFormat) return {};
    return this.bookFormatProcessingService.parseMetadata(filePath, detectedFormat);
  }

  private async findMatchingBook(title: string, author: string, isbn?: string): Promise<Result<Book>> {
    if (isbn) {
      const byIsbn = await this.bookRepository.searchWithFilters({ isbn }, 10, 0);
      if (byIsbn.isSuccess()) {
        const match = byIsbn.value.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
        if (match) return this.bookRepository.findById(match.id);
      }
    }

    const byAuthorAndTitle = await this.bookRepository.searchByAuthorAndTitle(author, title, 10, 0);
    if (byAuthorAndTitle.isSuccess()) {
      const match = byAuthorAndTitle.value.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
      if (match) return this.bookRepository.findById(match.id);
    }

    const byTitle = await this.bookRepository.searchWithFilters({ query: title }, 20, 0);
    if (byTitle.isSuccess()) {
      const match = byTitle.value.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
      if (match) return this.bookRepository.findById(match.id);
    }

    return Result.fail(new BookNotFoundFailure());
  }

  private withUpsertedFormat(book: Book, nextFormat: BookFormat, overrides: Partial<Book> = {}): Book {
    const existingFormats = getAvailableBookFormatsFromBook(book)
      .filter((format) => format.fileName !== nextFormat.fileName)
      .map((format) => withBookMetadataFallback(format, book));
    const formats = [...existingFormats, nextFormat];
    const preferredFormat = getPreferredBookFormat(formats);
    return BookFactory.reconstitute(book, {
      ...overrides,
      fileName: preferredFormat?.fileName ?? overrides.fileName ?? book.fileName,
      fileMtime: preferredFormat?.fileMtime ?? overrides.fileMtime ?? book.fileMtime,
      fileContentHash: preferredFormat?.fileContentHash ?? overrides.fileContentHash ?? book.fileContentHash,
      formats,
    });
  }

  private withUpdatedFormatState(book: Book, fileName: string, overrides: Partial<Book>): Book {
    const formats = getAvailableBookFormatsFromBook(book).map((format) =>
      format.fileName === fileName ? cloneBookFormat(format, this.toFormatOverrides(overrides)) : format,
    );
    const { fileMtime, fileContentHash, ...restOverrides } = overrides;
    const baseBook = BookFactory.reconstitute(book, { ...restOverrides, formats });
    if (book.fileName === fileName) {
      return BookFactory.reconstitute(baseBook, {
        fileMtime: fileMtime ?? book.fileMtime,
        fileContentHash: fileContentHash ?? book.fileContentHash,
      });
    }
    return baseBook;
  }

  private toFormatOverrides(overrides: Partial<Book>): Partial<BookFormatProps> {
    return {
      fileMtime: overrides.fileMtime,
      fileContentHash: overrides.fileContentHash,
      title: overrides.title,
      author: overrides.author,
      genres: overrides.genres,
      publishedYear: overrides.publishedYear,
      coverImageFileName: overrides.coverImageFileName,
      summary: overrides.summary,
      series: overrides.series,
      seriesPosition: overrides.seriesPosition,
      isbn: overrides.isbn,
      pageCount: overrides.pageCount,
      publisher: overrides.publisher,
      language: overrides.language,
    };
  }
}
