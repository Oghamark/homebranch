import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreateBookRequest } from '../../contracts/book/create-book-request';
import { IBookRepository } from '../../interfaces/book-repository';
import { IBookDuplicateRepository } from '../../interfaces/book-duplicate-repository';
import { BookFactory } from 'src/domain/entities/book.factory';
import { Book } from 'src/domain/entities/book.entity';
import { BookDuplicate } from 'src/domain/entities/book-duplicate.entity';
import { metadataMatches } from 'src/domain/services/book-deduplication.service';
import { randomUUID } from 'crypto';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';
import { IEpubParser } from 'src/application/interfaces/epub-parser';
import { IContentHashService } from 'src/application/interfaces/content-hash-service';
import { BookMissingMetadataFailure } from 'src/domain/failures/book.failures';
import { writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';

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
    @Inject('EpubParser') private epubParser: IEpubParser,
    @Inject('ContentHashService') private contentHashService: IContentHashService,
  ) {}

  async execute(dto: CreateBookRequest): Promise<Result<CreateBookResult>> {
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    const epubPath = join(uploadsDirectory, 'books', basename(dto.fileName));

    const enrichedDto = { ...dto };
    let epubSummary: string | undefined;
    let extractedCoverFileName: string | undefined;

    try {
      const epubMeta = await this.epubParser.parse(epubPath);

      // User-provided fields win; epub fills blanks
      if (!enrichedDto.title && epubMeta.title) enrichedDto.title = epubMeta.title;
      if (!enrichedDto.author && epubMeta.author) enrichedDto.author = epubMeta.author;
      if (!enrichedDto.language && epubMeta.language) enrichedDto.language = epubMeta.language;
      if (!enrichedDto.publisher && epubMeta.publisher) enrichedDto.publisher = epubMeta.publisher;
      if (!enrichedDto.publishedYear && epubMeta.publishedYear)
        enrichedDto.publishedYear = String(epubMeta.publishedYear);
      if (!enrichedDto.isbn && epubMeta.isbn) enrichedDto.isbn = epubMeta.isbn;
      if (epubMeta.summary) epubSummary = epubMeta.summary;
      if (!enrichedDto.genres?.length && epubMeta.genres?.length) enrichedDto.genres = epubMeta.genres;
      if (!enrichedDto.series && epubMeta.series) enrichedDto.series = epubMeta.series;
      if (!enrichedDto.seriesPosition && epubMeta.seriesPosition) enrichedDto.seriesPosition = epubMeta.seriesPosition;

      // Extract and save cover image from epub if none was uploaded
      if (!enrichedDto.coverImageFileName && epubMeta.coverImageBuffer) {
        const coverFileName = `${randomUUID()}.jpg`;
        const coverPath = join(uploadsDirectory, 'cover-images', coverFileName);
        await writeFile(coverPath, epubMeta.coverImageBuffer);
        enrichedDto.coverImageFileName = coverFileName;
        extractedCoverFileName = coverFileName;
      }
    } catch (err) {
      this.logger.warn(`Could not parse EPUB metadata for "${dto.fileName}": ${String(err)}`);
    }

    if (!enrichedDto.title) return Result.fail(new BookMissingMetadataFailure('title'));
    if (!enrichedDto.author) return Result.fail(new BookMissingMetadataFailure('author'));

    // Compute content hash and check for duplicates
    const contentHash = await this.contentHashService.computeHash(epubPath);
    const existingByHash = await this.bookRepository.findByContentHash(contentHash);

    if (existingByHash.isSuccess()) {
      const existing = existingByHash.value;
      if (metadataMatches(existing, { title: enrichedDto.title, author: enrichedDto.author, isbn: enrichedDto.isbn })) {
        // Exact duplicate: clean up uploaded files and return existing book
        await this.deleteUploadedFiles(uploadsDirectory, dto.fileName, dto.coverImageFileName, extractedCoverFileName);
        return Result.ok({ book: existing, skipped: true });
      }
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
      epubSummary,
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
    );

    const createResult = await this.bookRepository.create(book);

    if (createResult.isSuccess()) {
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

  private async deleteUploadedFiles(
    uploadsDirectory: string,
    epubFileName: string,
    uploadedCoverFileName?: string,
    extractedCoverFileName?: string,
  ): Promise<void> {
    const filesToDelete = [
      join(uploadsDirectory, 'books', basename(epubFileName)),
      uploadedCoverFileName ? join(uploadsDirectory, 'cover-images', basename(uploadedCoverFileName)) : null,
      extractedCoverFileName ? join(uploadsDirectory, 'cover-images', basename(extractedCoverFileName)) : null,
    ].filter((f): f is string => f !== null && existsSync(f));

    await Promise.all(filesToDelete.map((f) => unlink(f)));
  }

  _parseYear(year: string): number | undefined {
    const yearNumber = parseInt(year);
    if (isNaN(yearNumber)) {
      return;
    }
    return yearNumber;
  }
}
