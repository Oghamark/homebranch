import {
  Controller,
  Get,
  Header,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { OpdsBasicAuthGuard } from 'src/infrastructure/guards/opds-basic-auth.guard';
import { OpdsAuthExceptionFilter, buildOpdsAuthDocument } from 'src/infrastructure/filters/opds-auth-exception.filter';
import { GetBooksUseCase } from 'src/application/usecases/book/get-books.usecase';
import { GetBookShelvesUseCase } from 'src/application/usecases/bookshelf/get-book-shelves-use-case.service';
import { GetBookShelfByIdUseCase } from 'src/application/usecases/bookshelf/get-book-shelf-by-id-use-case.service';
import { GetBookShelfBooksUseCase } from 'src/application/usecases/bookshelf/get-book-shelf-books-use-case.service';
import { GetOpdsNewArrivalsUseCase } from 'src/application/usecases/opds/get-opds-new-arrivals.usecase';
import { DownloadBookUseCase } from 'src/application/usecases/book/download-book.usecase';
import { OpdsV1Builder } from 'src/presentation/opds/opds-v1.builder';
import { OPDS_MEDIA_TYPE } from 'src/presentation/opds/opds-link.helper';
import { Request, Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { basename, join } from 'path';

const DEFAULT_LIMIT = 20;

@Controller('opds/v1')
@UseFilters(OpdsAuthExceptionFilter)
export class OpdsV1Controller {
  private readonly logger = new Logger(OpdsV1Controller.name);

  constructor(
    private readonly getBooksUseCase: GetBooksUseCase,
    private readonly getBookShelvesUseCase: GetBookShelvesUseCase,
    private readonly getBookShelfByIdUseCase: GetBookShelfByIdUseCase,
    private readonly getBookShelfBooksUseCase: GetBookShelfBooksUseCase,
    private readonly getOpdsNewArrivalsUseCase: GetOpdsNewArrivalsUseCase,
    private readonly downloadBookUseCase: DownloadBookUseCase,
    private readonly opdsV1Builder: OpdsV1Builder,
  ) {}

  @Get('catalog')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  getCatalog(): string {
    return this.opdsV1Builder.buildCatalogFeed();
  }

  @Get('books')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async getAllBooks(@Query('limit') limit?: number, @Query('offset') offset?: number): Promise<string> {
    const result = await this.getBooksUseCase.execute({ limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 });
    if (!result.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV1Builder.buildAllBooksFeed(result.value);
  }

  @Get('books/new')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async getNewArrivals(@Query('limit') limit?: number, @Query('offset') offset?: number): Promise<string> {
    const result = await this.getOpdsNewArrivalsUseCase.execute({ limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 });
    if (!result.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV1Builder.buildNewArrivalsFeed(result.value);
  }

  @Get('bookshelves')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async getBookshelves(@Query('limit') limit?: number, @Query('offset') offset?: number): Promise<string> {
    const result = await this.getBookShelvesUseCase.execute({ limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 });
    if (!result.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV1Builder.buildBookShelvesFeed(result.value);
  }

  @Get('bookshelves/:id')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async getBookshelfBooks(@Param('id') id: string): Promise<string> {
    const shelfResult = await this.getBookShelfByIdUseCase.execute({ id });
    if (!shelfResult.isSuccess()) throw new NotFoundException();
    const booksResult = await this.getBookShelfBooksUseCase.execute({ id });
    if (!booksResult.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV1Builder.buildBookShelfFeed(shelfResult.value, booksResult.value);
  }

  @Get('search')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async search(
    @Query('q') q: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    const result = await this.getBooksUseCase.execute({
      query: q ?? '',
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    });
    if (!result.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV1Builder.buildSearchFeed(result.value, q ?? '');
  }

  @Get('opensearch.xml')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPENSEARCH)
  getOpenSearchDescription(): string {
    return this.opdsV1Builder.buildOpenSearchDescription();
  }

  /** OPDS Authentication 1.0 document — public, no auth required */
  @Get('auth')
  getAuthDocument(@Req() request: Request, @Res() response: Response): void {
    const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol);
    const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost');
    const authDocUrl = `${proto}://${host}/opds/v1/auth`;
    response
      .status(200)
      .setHeader('Content-Type', 'application/opds-authentication+json')
      .send(JSON.stringify(buildOpdsAuthDocument(authDocUrl)));
  }

  @Get('download/:id')
  @UseGuards(OpdsBasicAuthGuard)
  async downloadBook(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | void> {
    const result = await this.downloadBookUseCase.execute({ id });

    if (result.isFailure()) {
      response.status(404).json({ success: false, error: result.failure.code, message: result.failure.message });
      return;
    }

    const book = result.value!;
    const sanitizedTitle = book.title.replace(/[^\w\s-]/g, '').trim() || 'book';
    const uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    const safeFileName = basename(book.fileName);
    const filePath = join(uploadsDirectory, 'books', safeFileName);

    if (!existsSync(filePath)) {
      response
        .status(404)
        .json({ success: false, error: 'BOOK_FILE_NOT_FOUND', message: 'Book file not found on server' });
      return;
    }

    const fileStream = createReadStream(filePath);
    fileStream.on('error', (err) => {
      this.logger.error(`Error streaming book file: ${err.message}`);
      fileStream.destroy();
    });

    return new StreamableFile(fileStream, {
      type: 'application/epub+zip',
      disposition: `attachment; filename="${sanitizedTitle}.epub"`,
    });
  }
}
