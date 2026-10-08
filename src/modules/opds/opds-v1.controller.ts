import { tenantScope, TenantUser } from 'src/common/utils/cloud';
import {
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { OpdsBasicAuthGuard } from 'src/common/guards/opds-basic-auth.guard';
import { buildOpdsAuthDocument, OpdsAuthExceptionFilter } from 'src/common/filters/opds-auth-exception.filter';
import { getBookFormatExtension, getBookFormatMediaType } from 'src/modules/book/format/book-format';
import { BookService } from 'src/modules/book/catalog/book.service';
import { OpdsV1Builder } from 'src/modules/opds/opds-v1.builder';
import { OPDS_MEDIA_TYPE } from 'src/modules/opds/opds-link.helper';
import { Request, Response } from 'express';
import { buildExternalBaseUrl } from 'src/common/utils/external-url';
import { BookShelfService } from 'src/modules/book-shelf/book-shelf.service';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../storage/storage.interface';
import { Readable } from 'node:stream';

const DEFAULT_LIMIT = 20;

const ownerScope = (request: Request): string | undefined => tenantScope(request.user as TenantUser);

@Controller('opds/v1')
@UseFilters(OpdsAuthExceptionFilter)
export class OpdsV1Controller {
  private readonly logger = new Logger(OpdsV1Controller.name);

  constructor(
    private readonly bookService: BookService,
    private readonly bookShelfService: BookShelfService,
    private readonly opdsV1Builder: OpdsV1Builder,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {}

  @Get('catalog')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  getCatalog(@Req() request: Request): string {
    this.logger.log('OPDS v1 catalog request received');
    return this.opdsV1Builder.buildCatalogFeed(buildExternalBaseUrl(request, { includeForwardedPrefix: true }));
  }

  @Get('books')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async getAllBooks(
    @Req() request: Request,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    this.logger.log(`OPDS v1 all books request received (limit: ${limit ?? DEFAULT_LIMIT}, offset: ${offset ?? 0})`);
    const books = await this.bookService.getBooks({
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
      userId: ownerScope(request),
    });
    return this.opdsV1Builder.buildAllBooksFeed(books, buildExternalBaseUrl(request, { includeForwardedPrefix: true }));
  }

  @Get('books/new')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async getNewArrivals(
    @Req() request: Request,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    this.logger.log(`OPDS v1 new arrivals request received (limit: ${limit ?? DEFAULT_LIMIT}, offset: ${offset ?? 0})`);
    const books = await this.bookService.getNewArrivals(limit ?? DEFAULT_LIMIT, offset ?? 0, ownerScope(request));
    return this.opdsV1Builder.buildNewArrivalsFeed(
      books,
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }

  @Get('bookshelves')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async getBookshelves(
    @Req() request: Request,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    this.logger.log(`OPDS v1 bookshelves request received (limit: ${limit ?? DEFAULT_LIMIT}, offset: ${offset ?? 0})`);
    const result = await this.bookShelfService.getBookShelves(limit ?? DEFAULT_LIMIT, offset ?? 0, ownerScope(request));
    return this.opdsV1Builder.buildBookShelvesFeed(
      result,
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }

  @Get('bookshelves/:id')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async getBookshelfBooks(@Req() request: Request, @Param('id') id: string): Promise<string> {
    this.logger.log(`OPDS v1 bookshelf request received (id: ${id})`);
    const shelfResult = await this.bookShelfService.getBookShelfById(id, ownerScope(request));
    const booksResult = await this.bookShelfService.getBookShelfBooks(id, ownerScope(request));
    return this.opdsV1Builder.buildBookShelfFeed(
      shelfResult,
      booksResult,
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }

  @Get('search')
  @UseGuards(OpdsBasicAuthGuard)
  @Header('Content-Type', OPDS_MEDIA_TYPE.CATALOG)
  async search(
    @Req() request: Request,
    @Query('q') q: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    this.logger.log(
      `OPDS v1 search request received (query: ${q ?? ''}, limit: ${limit ?? DEFAULT_LIMIT}, offset: ${offset ?? 0})`,
    );
    const result = await this.bookService.getBooks({
      query: q ?? '',
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
      userId: ownerScope(request),
    });
    return this.opdsV1Builder.buildSearchFeed(
      result,
      q ?? '',
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }

  @Get('opensearch.xml')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPENSEARCH)
  getOpenSearchDescription(@Req() request: Request): string {
    this.logger.log('OPDS v1 OpenSearch description request received');
    return this.opdsV1Builder.buildOpenSearchDescription(
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }

  /** OPDS Authentication 1.0 document — public, no auth required */
  @Get('auth')
  getAuthDocument(@Req() request: Request, @Res() response: Response): void {
    this.logger.log('OPDS v1 authentication document request received');
    const authDocUrl = `${buildExternalBaseUrl(request, { includeForwardedPrefix: true })}/opds/v1/auth`;
    response
      .status(200)
      .setHeader('Content-Type', 'application/opds-authentication+json')
      .send(JSON.stringify(buildOpdsAuthDocument(authDocUrl)));
  }

  @Get('download/:id')
  @UseGuards(OpdsBasicAuthGuard)
  async downloadBook(@Req() request: Request, @Param('id') id: string): Promise<StreamableFile | void> {
    this.logger.log(`OPDS v1 download request received (book id: ${id})`);
    const { book, format, fileName } = await this.bookService.getDownload(id, undefined, ownerScope(request));
    const sanitizedTitle = book.title.replace(/[^\w\s-]/g, '').trim() || 'book';

    const storageStreamResult = await this.storage.getFileStream(`books/${fileName}`);
    const stream = storageStreamResult.stream;

    const fileStream = Readable.from(stream);
    fileStream.on('error', (err) => {
      this.logger.error(`Error streaming book file: ${err.message}`);
    });

    return new StreamableFile(fileStream, {
      type: getBookFormatMediaType(format),
      disposition: `attachment; filename="${sanitizedTitle}${getBookFormatExtension(format)}"`,
    });
  }
}
