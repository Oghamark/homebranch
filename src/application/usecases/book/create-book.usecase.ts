import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreateBookRequest } from '../../contracts/book/create-book-request';
import { IBookRepository } from '../../interfaces/book-repository';
import { IBookDuplicateRepository } from '../../interfaces/book-duplicate-repository';
import { BookFileMetadata } from 'src/application/interfaces/book-metadata-parser';
import { BookFactory } from 'src/domain/entities/book.factory';
import { Book } from 'src/domain/entities/book.entity';
import { BookDuplicate } from 'src/domain/entities/book-duplicate.entity';
import { logicalBookMatches, metadataMatches } from 'src/domain/services/book-deduplication.service';
import { randomUUID } from 'crypto';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';
import { IContentHashService } from 'src/application/interfaces/content-hash-service';
import { IFileService } from 'src/application/interfaces/file-service';
import { BookMissingMetadataFailure } from 'src/domain/failures/book.failures';
import { join, basename } from 'path';
import { fillBookMetadataFromFileName } from 'src/domain/services/book-file-metadata';
import { buildBookFormatMetadata } from 'src/domain/services/book-format-metadata';
import { FileNameGenerator } from 'src/domain/services/filename-generator';
import { BookFormat, BookFormatType } from 'src/domain/entities/book-format.entity';
import {
  detectBookFormatFromFileName,
  getBookFormatExtension,
  getPreferredBookFormat,
} from 'src/domain/services/book-format';
import { BookNotFoundFailure } from 'src/domain/failures/book.failures';
import { BookFormatProcessingService } from 'src/infrastructure/services/book-format-processing.service';

export interface CreateBookResult {
  book: Book;
  skipped: boolean;
}

@Injectable()
export class CreateBookUseCase implements UseCase<CreateBookRequest, CreateBookResult> {
  private readonly logger = new Logger(CreateBookUseCase.name);

  constructor(
    @Inject('BookRepository') private bookRepository: IBookRepository,
    @Inject('BookDuplicateRepository') private duplicateRepository: IBookDuplicateRepository,
    @Inject('MetadataGateway') private metadataGateway: IMetadataGateway,
    @Inject('ContentHashService') private contentHashService: IContentHashService,
    @Inject('FileService') private fileService: IFileService,
    private readonly bookFormatProcessingService: BookFormatProcessingService,
  ) {}

  async execute(dto: CreateBookRequest): Promise<Result<CreateBookResult>> {
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    // Uploaded files land in incoming/ staging area (file watcher only watches books/)
    const incomingPath = join(uploadsDirectory, 'incoming', basename(dto.fileName));

    const enrichedDto = { ...dto };
    const detectedFormat = detectBookFormatFromFileName(dto.fileName);
    if (!detectedFormat) return Result.fail(new BookMissingMetadataFailure('format'));

    let parsedSummary: string | undefined;
    let extractedCoverFileName: string | undefined;
    let fileMetadata: BookFileMetadata = {};

    try {
      fileMetadata = await this.bookFormatProcessingService.parseMetadata(incomingPath, detectedFormat);

      // User-provided fields win; epub fills blanks
      if (!enrichedDto.title && fileMetadata.title) enrichedDto.title = fileMetadata.title;
      if (!enrichedDto.author && fileMetadata.author) enrichedDto.author = fileMetadata.author;
      if (!enrichedDto.language && fileMetadata.language) enrichedDto.language = fileMetadata.language;
      if (!enrichedDto.publisher && fileMetadata.publisher) enrichedDto.publisher = fileMetadata.publisher;
      if (!enrichedDto.publishedYear && fileMetadata.publishedYear)
        enrichedDto.publishedYear = String(fileMetadata.publishedYear);
      if (!enrichedDto.isbn && fileMetadata.isbn) enrichedDto.isbn = fileMetadata.isbn;
      if (fileMetadata.summary) parsedSummary = fileMetadata.summary;
      if (!enrichedDto.genres?.length && fileMetadata.genres?.length) enrichedDto.genres = fileMetadata.genres;
      if (!enrichedDto.series && fileMetadata.series) enrichedDto.series = fileMetadata.series;
      if (!enrichedDto.seriesPosition && fileMetadata.seriesPosition) enrichedDto.seriesPosition = fileMetadata.seriesPosition;
      if (!enrichedDto.pageCount && fileMetadata.pageCount) enrichedDto.pageCount = fileMetadata.pageCount;

      // Extract and save cover image from epub if none was uploaded
      if (!enrichedDto.coverImageFileName && fileMetadata.coverImageBuffer) {
        const coverFileName = `${randomUUID()}.jpg`;
        const coverPath = join(uploadsDirectory, 'cover-images', coverFileName);
        await this.fileService.writeFile(coverPath, fileMetadata.coverImageBuffer);
        enrichedDto.coverImageFileName = coverFileName;
        extractedCoverFileName = coverFileName;
      }
    } catch (err) {
      this.logger.warn(`Could not parse file metadata for "${dto.fileName}": ${String(err)}`);
    }

    fillBookMetadataFromFileName(enrichedDto, dto.originalFileName ?? dto.fileName);

    if (!enrichedDto.title) return Result.fail(new BookMissingMetadataFailure('title'));
    if (!enrichedDto.author) return Result.fail(new BookMissingMetadataFailure('author'));

    const matchingBook = await this.findMatchingBook(enrichedDto.title, enrichedDto.author, enrichedDto.isbn);
    if (matchingBook.isFailure()) {
      this.logger.debug(`No logical book match found for "${enrichedDto.title}" by ${enrichedDto.author}`);
    }

    // Compute content hash and check for duplicates
    const contentHash = await this.contentHashService.computeHash(incomingPath);
    const existingByHash = await this.bookRepository.findByContentHash(contentHash);

    if (existingByHash.isSuccess()) {
      const existing = existingByHash.value;
      if (metadataMatches(existing, { title: enrichedDto.title, author: enrichedDto.author, isbn: enrichedDto.isbn })) {
        // Exact duplicate: clean up staging files and return existing book
        await this.deleteIncomingFiles(uploadsDirectory, dto.fileName, dto.coverImageFileName, extractedCoverFileName);
        return Result.ok({ book: existing, skipped: true });
      }
    }

    const preferredBook = matchingBook.isSuccess() ? matchingBook.value : undefined;
    if (preferredBook?.formats?.some((format) => format.format === detectedFormat)) {
      await this.deleteIncomingFiles(uploadsDirectory, dto.fileName, dto.coverImageFileName, extractedCoverFileName);
      return Result.ok({ book: preferredBook, skipped: true });
    }

    // Determine the final filename (Author - Title.ext) and resolve collisions
    const desiredFileName = FileNameGenerator.generate(
      enrichedDto.author,
      enrichedDto.title,
      getBookFormatExtension(detectedFormat),
    );
    const finalFileName = this.resolveUniqueFileName(uploadsDirectory, desiredFileName);
    enrichedDto.fileName = finalFileName;
    const newFormat = new BookFormat({
      id: randomUUID(),
      format: detectedFormat,
      fileName: finalFileName,
      fileContentHash: contentHash,
      ...buildBookFormatMetadata(fileMetadata, dto.originalFileName ?? dto.fileName, enrichedDto.coverImageFileName),
    });

    if (preferredBook) {
      const updatedFormats = [...(preferredBook.formats ?? []), newFormat];
      const preferredFormat = getPreferredBookFormat(updatedFormats);
      const updatedBook = BookFactory.reconstitute(preferredBook, {
        title: preferredBook.title || enrichedDto.title,
        author: preferredBook.author || enrichedDto.author,
        coverImageFileName: preferredBook.coverImageFileName ?? enrichedDto.coverImageFileName,
        summary: preferredBook.summary ?? parsedSummary,
        genres: preferredBook.genres?.length ? preferredBook.genres : enrichedDto.genres,
        publishedYear: preferredBook.publishedYear ?? this._parseYear(enrichedDto.publishedYear ?? ''),
        uploadedByUserId: preferredBook.uploadedByUserId ?? enrichedDto.uploadedByUserId,
        series: preferredBook.series ?? enrichedDto.series,
        seriesPosition: preferredBook.seriesPosition ?? enrichedDto.seriesPosition,
        isbn: preferredBook.isbn ?? enrichedDto.isbn,
        pageCount: preferredBook.pageCount ?? enrichedDto.pageCount,
        publisher: preferredBook.publisher ?? enrichedDto.publisher,
        language: preferredBook.language ?? enrichedDto.language,
        fileName: preferredFormat?.fileName ?? preferredBook.fileName,
        fileMtime: preferredFormat?.fileMtime ?? preferredBook.fileMtime,
        fileContentHash: preferredFormat?.fileContentHash ?? preferredBook.fileContentHash,
        formats: updatedFormats,
      });

      const updateResult = await this.bookRepository.update(preferredBook.id, updatedBook);
      if (updateResult.isFailure()) return Result.fail(updateResult.failure);

      await this.fileService.moveFile(incomingPath, join(uploadsDirectory, 'books', finalFileName));
      return Result.ok({ book: updateResult.value!, skipped: false });
    }

    const id = randomUUID();
    const book = BookFactory.create(
      id,
      enrichedDto.title,
      enrichedDto.author,
      enrichedDto.fileName,
      enrichedDto.isFavorite ?? false,
      enrichedDto.genres,
      enrichedDto.publishedYear ? this._parseYear(enrichedDto.publishedYear) : undefined,
      enrichedDto.coverImageFileName,
      parsedSummary,
      enrichedDto.uploadedByUserId,
      enrichedDto.series,
      enrichedDto.seriesPosition,
      enrichedDto.isbn,
      enrichedDto.pageCount,
      enrichedDto.publisher,
      enrichedDto.language,
      enrichedDto.averageRating,
      enrichedDto.ratingsCount,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      contentHash,
      undefined,
      [newFormat],
    );

    const createResult = await this.bookRepository.create(book);

    if (createResult.isSuccess()) {
      // Move the file from staging to the books directory now that the DB record exists
      await this.fileService.moveFile(incomingPath, join(uploadsDirectory, 'books', finalFileName));

      // If a book with the same content hash exists but different metadata, flag as potential duplicate
      if (existingByHash.isSuccess()) {
        const duplicate = new BookDuplicate(randomUUID(), createResult.value.id, existingByHash.value.id, new Date());
        await this.duplicateRepository.create(duplicate);
        this.logger.log(
          `Potential duplicate flagged: new book "${createResult.value.title}" (${createResult.value.id}) vs existing "${existingByHash.value.title}" (${existingByHash.value.id})`,
        );
      }

      void this.metadataGateway
        .enrichBook(createResult.value)
        .then((enriched) => this.bookRepository.update(enriched.id, enriched))
        .catch((err: unknown) => {
          this.logger.warn(`Background metadata fetch failed for book "${book.title}": ${String(err)}`);
        });

      return Result.ok({ book: createResult.value, skipped: false });
    }

    return Result.fail(createResult.failure!);
  }

  private async deleteIncomingFiles(
    uploadsDirectory: string,
    uploadedFileName: string,
    uploadedCoverFileName?: string,
    extractedCoverFileName?: string,
  ): Promise<void> {
    const filesToDelete = [
      join(uploadsDirectory, 'incoming', basename(uploadedFileName)),
      uploadedCoverFileName ? join(uploadsDirectory, 'cover-images', basename(uploadedCoverFileName)) : null,
      extractedCoverFileName ? join(uploadsDirectory, 'cover-images', basename(extractedCoverFileName)) : null,
    ].filter((f): f is string => f !== null && this.fileService.fileExists(f));

    await Promise.all(filesToDelete.map((f) => this.fileService.deleteFile(f)));
  }

  private resolveUniqueFileName(uploadsDirectory: string, desiredFileName: string): string {
    const booksDir = join(uploadsDirectory, 'books');
    if (!this.fileService.fileExists(join(booksDir, desiredFileName))) return desiredFileName;

    const extensionIndex = desiredFileName.lastIndexOf('.');
    const ext = extensionIndex >= 0 ? desiredFileName.slice(extensionIndex) : '';
    const nameWithoutExt = extensionIndex >= 0 ? desiredFileName.slice(0, extensionIndex) : desiredFileName;
    let counter = 2;
    let candidate = `${nameWithoutExt} (${counter})${ext}`;
    while (this.fileService.fileExists(join(booksDir, candidate))) {
      counter++;
      candidate = `${nameWithoutExt} (${counter})${ext}`;
    }
    return candidate;
  }

  _parseYear(year: string): number | undefined {
    const yearNumber = parseInt(year);
    if (isNaN(yearNumber)) {
      return;
    }
    return yearNumber;
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
}
