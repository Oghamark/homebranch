import {
  Controller,
  Get,
  Header,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { OpdsBasicAuthGuard } from 'src/infrastructure/guards/opds-basic-auth.guard';
import { OpdsAuthExceptionFilter } from 'src/infrastructure/filters/opds-auth-exception.filter';
import { GetBooksUseCase } from 'src/application/usecases/book/get-books.usecase';
import { GetBookShelvesUseCase } from 'src/application/usecases/bookshelf/get-book-shelves-use-case.service';
import { GetBookShelfByIdUseCase } from 'src/application/usecases/bookshelf/get-book-shelf-by-id-use-case.service';
import { GetBookShelfBooksUseCase } from 'src/application/usecases/bookshelf/get-book-shelf-books-use-case.service';
import { GetOpdsNewArrivalsUseCase } from 'src/application/usecases/opds/get-opds-new-arrivals.usecase';
import { OpdsV2Builder } from 'src/presentation/opds/opds-v2.builder';
import { OPDS_MEDIA_TYPE } from 'src/presentation/opds/opds-link.helper';

const DEFAULT_LIMIT = 20;

@Controller('opds/v2')
@UseGuards(OpdsBasicAuthGuard)
@UseFilters(OpdsAuthExceptionFilter)
export class OpdsV2Controller {
  constructor(
    private readonly getBooksUseCase: GetBooksUseCase,
    private readonly getBookShelvesUseCase: GetBookShelvesUseCase,
    private readonly getBookShelfByIdUseCase: GetBookShelfByIdUseCase,
    private readonly getBookShelfBooksUseCase: GetBookShelfBooksUseCase,
    private readonly getOpdsNewArrivalsUseCase: GetOpdsNewArrivalsUseCase,
    private readonly opdsV2Builder: OpdsV2Builder,
  ) {}

  @Get('catalog')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  getCatalog(): string {
    return this.opdsV2Builder.buildCatalogFeed();
  }

  @Get('books')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async getAllBooks(@Query('limit') limit?: number, @Query('offset') offset?: number): Promise<string> {
    const result = await this.getBooksUseCase.execute({ limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 });
    if (!result.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV2Builder.buildAllBooksFeed(result.value);
  }

  @Get('books/new')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async getNewArrivals(@Query('limit') limit?: number, @Query('offset') offset?: number): Promise<string> {
    const result = await this.getOpdsNewArrivalsUseCase.execute({ limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 });
    if (!result.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV2Builder.buildNewArrivalsFeed(result.value);
  }

  @Get('bookshelves')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async getBookshelves(@Query('limit') limit?: number, @Query('offset') offset?: number): Promise<string> {
    const result = await this.getBookShelvesUseCase.execute({ limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 });
    if (!result.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV2Builder.buildBookShelvesFeed(result.value);
  }

  @Get('bookshelves/:id')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
  async getBookshelfBooks(@Param('id') id: string): Promise<string> {
    const shelfResult = await this.getBookShelfByIdUseCase.execute({ id });
    if (!shelfResult.isSuccess()) throw new NotFoundException();
    const booksResult = await this.getBookShelfBooksUseCase.execute({ id });
    if (!booksResult.isSuccess()) throw new InternalServerErrorException();
    return this.opdsV2Builder.buildBookShelfFeed(shelfResult.value, booksResult.value);
  }

  @Get('search')
  @Header('Content-Type', OPDS_MEDIA_TYPE.OPDS_JSON)
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
    return this.opdsV2Builder.buildSearchFeed(result.value, q ?? '');
  }
}
