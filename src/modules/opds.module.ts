import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth.module';
import { BooksModule } from './book.module';
import { BookShelfEntity } from 'src/infrastructure/database/book-shelf.entity';
import { BookEntity } from 'src/infrastructure/database/book.entity';
import { TypeOrmBookShelfRepository } from 'src/infrastructure/repositories/book-shelf.repository';
import { GetBookShelvesUseCase } from 'src/application/usecases/bookshelf/get-book-shelves-use-case.service';
import { GetBookShelfByIdUseCase } from 'src/application/usecases/bookshelf/get-book-shelf-by-id-use-case.service';
import { GetBookShelfBooksUseCase } from 'src/application/usecases/bookshelf/get-book-shelf-books-use-case.service';
import { GetBooksUseCase } from 'src/application/usecases/book/get-books.usecase';
import { DownloadBookUseCase } from 'src/application/usecases/book/download-book.usecase';
import { GetOpdsNewArrivalsUseCase } from 'src/application/usecases/opds/get-opds-new-arrivals.usecase';
import { OpdsV1Builder } from 'src/presentation/opds/opds-v1.builder';
import { OpdsV2Builder } from 'src/presentation/opds/opds-v2.builder';
import { OpdsV1Controller } from 'src/presentation/controllers/opds-v1.controller';
import { OpdsV2Controller } from 'src/presentation/controllers/opds-v2.controller';
import { HttpAuthGateway } from 'src/infrastructure/gateways/http-auth.gateway';
import { OpdsBasicAuthGuard } from 'src/presentation/guards/opds-basic-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([BookEntity, BookShelfEntity]), AuthModule, BooksModule],
  providers: [
    // Authentication gateway (calls Auth service with email+password, returns JWT)
    {
      provide: 'AuthGateway',
      useClass: HttpAuthGateway,
    },

    // Guard (Basic Auth → Auth service → JWT verification)
    OpdsBasicAuthGuard,

    // Bookshelf repository (local to this module)
    {
      provide: 'BookShelfRepository',
      useClass: TypeOrmBookShelfRepository,
    },

    // Use Cases
    GetBooksUseCase,
    DownloadBookUseCase,
    GetBookShelvesUseCase,
    GetBookShelfByIdUseCase,
    GetBookShelfBooksUseCase,
    GetOpdsNewArrivalsUseCase,

    // Builders
    OpdsV1Builder,
    OpdsV2Builder,
  ],
  controllers: [OpdsV1Controller, OpdsV2Controller],
})
export class OpdsModule {}
