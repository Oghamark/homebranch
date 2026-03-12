import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreateBookUseCase } from 'src/application/usecases/book/create-book.usecase';
import { DeleteBookUseCase } from 'src/application/usecases/book/delete-book.usecase';
import { DownloadBookUseCase } from 'src/application/usecases/book/download-book.usecase';
import { GetBookByIdUseCase } from 'src/application/usecases/book/get-book-by-id.usecase';
import { GetBooksUseCase } from 'src/application/usecases/book/get-books.usecase';
import { GetFavoriteBooksUseCase } from 'src/application/usecases/book/get-favorite-books-use-case.service';
import { UpdateBookUseCase } from 'src/application/usecases/book/update-book.usecase';
import { BookEntity } from 'src/infrastructure/database/book.entity';
import { BookMapper } from 'src/infrastructure/mappers/book.mapper';
import { TypeOrmBookRepository } from 'src/infrastructure/repositories/book.repository';
import { BookController } from 'src/presentation/controllers/book.controller';
import { AuthModule } from 'src/modules/auth.module';
import { OpenLibraryGateway } from 'src/infrastructure/gateways/open-library.gateway';
import { GoogleBooksGateway } from 'src/infrastructure/gateways/google-books.gateway';
import { CompositeMetadataGateway } from 'src/infrastructure/gateways/composite-metadata.gateway';
import { CompositeSummaryGateway } from 'src/infrastructure/gateways/composite-summary.gateway';
import { FetchBookMetadataUseCase } from 'src/application/usecases/book/fetch-book-metadata-use-case.service';
import { FetchBookSummaryUseCase } from 'src/application/usecases/book/fetch-book-summary.usecase';
import { MetadataSchedulerService } from 'src/infrastructure/schedulers/metadata-scheduler.service';
import { EpubParserService } from 'src/infrastructure/parsers/epub-parser.service';
import { SettingsModule } from 'src/modules/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([BookEntity]), AuthModule, SettingsModule],
  providers: [
    // Repository
    {
      provide: 'BookRepository',
      useClass: TypeOrmBookRepository,
    },

    // Use Cases (add all that your controller uses)
    CreateBookUseCase,
    DeleteBookUseCase,
    DownloadBookUseCase,
    GetBooksUseCase,
    GetFavoriteBooksUseCase,
    GetBookByIdUseCase,
    UpdateBookUseCase,
    FetchBookMetadataUseCase,
    FetchBookSummaryUseCase,
    // ... other use cases

    // Mappers
    BookMapper,

    // Gateways
    {
      provide: 'OpenLibraryGateway',
      useClass: OpenLibraryGateway,
    },
    {
      provide: 'GoogleBooksGateway',
      useClass: GoogleBooksGateway,
    },
    {
      provide: 'MetadataGateway',
      useClass: CompositeMetadataGateway,
    },
    {
      provide: 'SummaryGateway',
      useClass: CompositeSummaryGateway,
    },

    // Parsers
    {
      provide: 'EpubParser',
      useClass: EpubParserService,
    },

    // Schedulers
    MetadataSchedulerService,
  ],
  controllers: [BookController],
  exports: ['BookRepository'],
})
export class BooksModule {}
