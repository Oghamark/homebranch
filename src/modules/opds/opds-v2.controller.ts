import { Controller, Get, Header, Logger, Param, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { OpdsBasicAuthGuard } from 'src/common/guards/opds-basic-auth.guard';
import { OpdsAuthExceptionFilter } from 'src/common/filters/opds-auth-exception.filter';
import { BookService } from 'src/modules/book/catalog/book.service';
import { OpdsV2Builder } from 'src/modules/opds/opds-v2.builder';
import { OPDS_MEDIA_TYPE } from 'src/modules/opds/opds-link.helper';
import { BookShelfService } from 'src/modules/book-shelf/book-shelf.service';
import { Request } from 'express';
import { buildExternalBaseUrl } from 'src/common/utils/external-url';

const DEFAULT_LIMIT = 20;

@Controller('opds/v2')
@UseGuards(OpdsBasicAuthGuard)
@UseFilters(OpdsAuthExceptionFilter)
export class OpdsV2Controller {
  private readonly logger = new Logger(OpdsV2Controller.name);

  constructor(
    private readonly bookService: BookService,
    private readonly bookShelfService: BookShelfService,
    private readonly opdsV2Builder: OpdsV2Builder,
  ) {}

  @Get('catalog')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  getCatalog(@Req() request: Request): string {
    this.logger.log('OPDS v2 catalog request received');
    return this.opdsV2Builder.buildCatalogFeed(buildExternalBaseUrl(request, { includeForwardedPrefix: true }));
  }

  @Get('books')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async getAllBooks(
    @Req() request: Request,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    this.logger.log(`OPDS v2 all books request received (limit: ${limit ?? DEFAULT_LIMIT}, offset: ${offset ?? 0})`);
    const books = await this.bookService.getBooks({ limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 });
    return this.opdsV2Builder.buildAllBooksFeed(books, buildExternalBaseUrl(request, { includeForwardedPrefix: true }));
  }

  @Get('books/new')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async getNewArrivals(
    @Req() request: Request,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    this.logger.log(`OPDS v2 new arrivals request received (limit: ${limit ?? DEFAULT_LIMIT}, offset: ${offset ?? 0})`);
    const books = await this.bookService.getNewArrivals(limit ?? DEFAULT_LIMIT, offset ?? 0);
    return this.opdsV2Builder.buildNewArrivalsFeed(
      books,
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }

  @Get('bookshelves')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async getBookshelves(
    @Req() request: Request,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    this.logger.log(`OPDS v2 bookshelves request received (limit: ${limit ?? DEFAULT_LIMIT}, offset: ${offset ?? 0})`);
    const result = await this.bookShelfService.getBookShelves(limit ?? DEFAULT_LIMIT, offset ?? 0);
    return this.opdsV2Builder.buildBookShelvesFeed(
      result,
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }

  @Get('bookshelves/:id')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async getBookshelfBooks(@Req() request: Request, @Param('id') id: string): Promise<string> {
    this.logger.log(`OPDS v2 bookshelf request received (id: ${id})`);
    const shelfResult = await this.bookShelfService.getBookShelfById(id);
    const booksResult = await this.bookShelfService.getBookShelfBooks(id);
    return this.opdsV2Builder.buildBookShelfFeed(
      shelfResult,
      booksResult,
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }

  @Get('search')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async search(
    @Req() request: Request,
    @Query('q') q: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<string> {
    this.logger.log(
      `OPDS v2 search request received (query: ${q ?? ''}, limit: ${limit ?? DEFAULT_LIMIT}, offset: ${offset ?? 0})`,
    );
    const result = await this.bookService.getBooks({
      query: q ?? '',
      limit: limit ?? DEFAULT_LIMIT,
      offset: offset ?? 0,
    });
    return this.opdsV2Builder.buildSearchFeed(
      result,
      q ?? '',
      buildExternalBaseUrl(request, { includeForwardedPrefix: true }),
    );
  }
}
