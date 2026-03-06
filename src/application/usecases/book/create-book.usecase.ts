import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreateBookRequest } from '../../contracts/book/create-book-request';
import { IBookRepository } from '../../interfaces/book-repository';
import { BookFactory } from 'src/domain/entities/book.factory';
import { Book } from 'src/domain/entities/book.entity';
import { randomUUID } from 'crypto';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';
import { IEpubParser } from 'src/application/interfaces/epub-parser';
import { BookMissingMetadataFailure } from 'src/domain/failures/book.failures';
import { writeFile } from 'fs/promises';
import { join, basename } from 'path';

@Injectable()
export class CreateBookUseCase implements UseCase<CreateBookRequest, Book> {
  private readonly logger = new Logger(CreateBookUseCase.name);

  constructor(
    @Inject('BookRepository') private bookRepository: IBookRepository,
    @Inject('MetadataGateway') private metadataGateway: IMetadataGateway,
    @Inject('EpubParser') private epubParser: IEpubParser,
  ) {}

  async execute(dto: CreateBookRequest): Promise<Result<Book>> {
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    const epubPath = join(uploadsDirectory, 'books', basename(dto.fileName));

    const enrichedDto = { ...dto };
    let epubSummary: string | undefined;

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
      }
    } catch (err) {
      this.logger.warn(`Could not parse EPUB metadata for "${dto.fileName}": ${String(err)}`);
    }

    if (!enrichedDto.title) return Result.fail(new BookMissingMetadataFailure('title'));
    if (!enrichedDto.author) return Result.fail(new BookMissingMetadataFailure('author'));

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
    );

    const createResult = await this.bookRepository.create(book);

    if (createResult.isSuccess()) {
      void this.metadataGateway
        .enrichBook(createResult.value)
        .then((enriched) => this.bookRepository.update(enriched.id, enriched))
        .catch((err: unknown) => {
          this.logger.warn(`Background metadata fetch failed for book "${book.title}": ${String(err)}`);
        });
    }

    return createResult;
  }

  _parseYear(year: string): number | undefined {
    const yearNumber = parseInt(year);
    if (isNaN(yearNumber)) {
      return;
    }
    return yearNumber;
  }
}
