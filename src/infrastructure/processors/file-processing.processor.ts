import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { statSync, existsSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { IEpubParser } from 'src/application/interfaces/epub-parser';
import { IContentHashService } from 'src/application/interfaces/content-hash-service';
import { IEpubMetadataWriter } from 'src/application/interfaces/epub-metadata-writer';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';
import { ISettingRepository } from 'src/application/interfaces/setting-repository';
import { BookFactory } from 'src/domain/entities/book.factory';
import { SyncableMetadata, SyncableMetadataHelper } from 'src/domain/value-objects/syncable-metadata';
import { MetadataMerger } from 'src/domain/services/metadata-merger';
import { LibraryEventsService } from 'src/infrastructure/services/library-events.service';

@Processor('file-processing')
export class FileProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(FileProcessingProcessor.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('EpubParser') private readonly epubParser: IEpubParser,
    @Inject('ContentHashService') private readonly contentHashService: IContentHashService,
    @Inject('EpubMetadataWriter') private readonly epubMetadataWriter: IEpubMetadataWriter,
    @Inject('MetadataGateway') private readonly metadataGateway: IMetadataGateway,
    @Inject('SettingRepository') private readonly settingRepository: ISettingRepository,
    private readonly libraryEventsService: LibraryEventsService,
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
    await job.updateProgress(10);

    const contentHash = await this.contentHashService.computeHash(filePath);
    await job.updateProgress(30);

    // Check for soft-deleted book with same filename
    const byNameResult = await this.bookRepository.findByFileName(fileName, true);
    if (byNameResult.isSuccess() && byNameResult.value.deletedAt) {
      this.logger.log(`Restoring soft-deleted book by filename: "${byNameResult.value.title}"`);
      await this.bookRepository.restore(byNameResult.value.id);
      await this.updateBookFileMetadata(byNameResult.value.id, filePath, contentHash);
      await this.performMetadataSync(byNameResult.value.id, filePath);
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
      const book = BookFactory.reconstitute(byHashResult.value, { fileName, deletedAt: undefined });
      await this.bookRepository.update(byHashResult.value.id, book);
      await this.bookRepository.restore(byHashResult.value.id);
      await this.updateBookFileMetadata(byHashResult.value.id, filePath, contentHash);
      this.libraryEventsService.emit({ type: 'book-added', bookId: byHashResult.value.id });
      await job.updateProgress(100);
      return;
    }

    // Already exists and active — check if file content changed
    if (byNameResult.isSuccess() && !byNameResult.value.deletedAt) {
      const existingBook = byNameResult.value;
      if (existingBook.fileContentHash !== contentHash) {
        this.logger.log(`File content changed for existing book "${existingBook.title}", syncing metadata`);
        await this.performMetadataSync(existingBook.id, filePath);
      } else {
        this.logger.debug(`Book already exists and unchanged: ${fileName}`);
      }
      await job.updateProgress(100);
      return;
    }

    // New book — parse EPUB metadata
    await job.updateProgress(40);
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';

    let title: string | undefined;
    let author: string | undefined;
    let epubMeta: Awaited<ReturnType<typeof this.epubParser.parse>> = {};

    try {
      epubMeta = await this.epubParser.parse(filePath);
      title = epubMeta.title;
      author = epubMeta.author;
    } catch (err) {
      this.logger.warn(`Could not parse EPUB metadata for "${fileName}": ${String(err)}`);
    }

    await job.updateProgress(60);

    // Derive title/author from filename if not in EPUB metadata
    if (!title) {
      const nameWithoutExt = fileName.replace(/\.epub$/i, '');
      const parts = nameWithoutExt.split(' - ');
      if (parts.length >= 2) {
        author = author || parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        title = nameWithoutExt.trim();
      }
    }
    if (!author) author = 'Unknown Author';

    // Extract and save cover image
    let coverImageFileName: string | undefined;
    if (epubMeta.coverImageBuffer) {
      coverImageFileName = `${randomUUID()}.jpg`;
      const coverPath = join(uploadsDirectory, 'cover-images', coverImageFileName);
      await writeFile(coverPath, epubMeta.coverImageBuffer);
    }

    const stat = statSync(filePath);
    const id = randomUUID();
    const syncSnapshot = SyncableMetadataHelper.fromBook({
      title,
      author,
      language: epubMeta.language,
      publisher: epubMeta.publisher,
      publishedYear: epubMeta.publishedYear,
      isbn: epubMeta.isbn,
      summary: epubMeta.summary,
      genres: epubMeta.genres,
      series: epubMeta.series,
      seriesPosition: epubMeta.seriesPosition,
    }) as unknown as Record<string, unknown>;

    const defaultOwnerId = await this.getDefaultScanUserId();

    const book = BookFactory.create(
      id,
      title,
      author,
      fileName,
      false, // isFavorite
      epubMeta.genres || [],
      epubMeta.publishedYear,
      coverImageFileName,
      epubMeta.summary,
      defaultOwnerId, // uploadedByUserId — use default scan user if configured
      epubMeta.series,
      epubMeta.seriesPosition,
      epubMeta.isbn,
      undefined, // pageCount
      epubMeta.publisher,
      epubMeta.language,
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

  private async updateBookFileMetadata(bookId: string, filePath: string, contentHash: string) {
    const stat = statSync(filePath);
    const bookResult = await this.bookRepository.findById(bookId);
    if (bookResult.isSuccess()) {
      const book = BookFactory.reconstitute(bookResult.value, {
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
    await this.performMetadataSync(bookId, filePath);
    await job.updateProgress(100);
  }

  private async performMetadataSync(bookId: string, filePath: string): Promise<void> {
    const bookResult = await this.bookRepository.findById(bookId);
    if (!bookResult.isSuccess()) {
      this.logger.warn(`Book ${bookId} not found for sync`);
      return;
    }

    const book = bookResult.value;

    let fileMetadata: SyncableMetadata;
    try {
      const epubMeta = await this.epubParser.parse(filePath);
      fileMetadata = SyncableMetadataHelper.fromBook({
        title: epubMeta.title || book.title,
        author: epubMeta.author || book.author,
        language: epubMeta.language,
        publisher: epubMeta.publisher,
        publishedYear: epubMeta.publishedYear,
        isbn: epubMeta.isbn,
        summary: epubMeta.summary,
        genres: epubMeta.genres,
        series: epubMeta.series,
        seriesPosition: epubMeta.seriesPosition,
      });
    } catch (err) {
      this.logger.warn(`Cannot parse EPUB for sync: ${String(err)}`);
      return;
    }

    const dbMetadata = SyncableMetadataHelper.fromBook(book);
    const lastSynced = (book.syncedMetadata as unknown as SyncableMetadata) || null;
    const mergeResult = MetadataMerger.merge(fileMetadata, dbMetadata, lastSynced, this.logger);

    const stat = statSync(filePath);
    let finalMtime = stat.mtimeMs;
    let finalHash = await this.contentHashService.computeHash(filePath);

    if (mergeResult.fileUpdated) {
      try {
        await this.epubMetadataWriter.writeMetadata(filePath, mergeResult.merged);

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
        fileMtime: finalMtime,
        fileContentHash: finalHash,
      });
      await this.bookRepository.update(bookId, updatedBook);
      if (mergeResult.dbUpdated) this.logger.log(`Updated DB metadata for "${book.title}"`);
      this.libraryEventsService.emit({ type: 'book-updated', bookId });
    } else {
      // No metadata changes — still update file-tracking fields so the periodic
      // scan does not re-trigger sync indefinitely.
      const updatedBook = BookFactory.reconstitute(book, {
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

    const result = await this.bookRepository.softDelete(bookId);
    if (result.isSuccess()) {
      this.logger.log(`Soft-deleted book "${result.value.title}"`);
      this.libraryEventsService.emit({ type: 'book-removed', bookId });
    }
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
        const updatedBook = BookFactory.reconstitute(bookResult.value, { fileName: newFileName });
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
}
