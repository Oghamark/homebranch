import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CreateBookUseCase } from 'src/application/usecases/book/create-book.usecase';
import { DeleteBookUseCase } from 'src/application/usecases/book/delete-book.usecase';
import { DownloadBookUseCase } from 'src/application/usecases/book/download-book.usecase';
import { GetBookByIdUseCase } from 'src/application/usecases/book/get-book-by-id.usecase';
import { GetBooksUseCase } from 'src/application/usecases/book/get-books.usecase';
import { GetFavoriteBooksUseCase } from 'src/application/usecases/book/get-favorite-books-use-case.service';
import { UpdateBookUseCase } from 'src/application/usecases/book/update-book.usecase';
import { AssignBookOwnerUseCase } from 'src/application/usecases/book/assign-book-owner.usecase';
import { ToggleBookFavoriteUseCase } from 'src/application/usecases/book/toggle-book-favorite-use-case.service';
import { ListDuplicatesUseCase } from 'src/application/usecases/book/list-duplicates.usecase';
import { ResolveDuplicateUseCase } from 'src/application/usecases/book/resolve-duplicate.usecase';
import { ScanDuplicatesUseCase } from 'src/application/usecases/book/scan-duplicates.usecase';
import { BookEntity } from 'src/infrastructure/database/book.entity';
import { BookDuplicateEntity } from 'src/infrastructure/database/book-duplicate.entity';
import { UserBookFavoriteEntity } from 'src/infrastructure/database/user-book-favorite.entity';
import { BookMapper } from 'src/infrastructure/mappers/book.mapper';
import { TypeOrmBookRepository } from 'src/infrastructure/repositories/book.repository';
import { TypeOrmBookDuplicateRepository } from 'src/infrastructure/repositories/book-duplicate.repository';
import { DuplicateScanProcessor } from 'src/infrastructure/processors/duplicate-scan.processor';
import { DuplicateScanSchedulerService } from 'src/infrastructure/schedulers/duplicate-scan-scheduler.service';
import { ContentHashService } from 'src/infrastructure/services/content-hash.service';
import { FileService } from 'src/infrastructure/services/file.service';
import { DuplicateScanQueueService } from 'src/infrastructure/services/duplicate-scan-queue.service';
import { FileProcessingQueueService } from 'src/infrastructure/services/file-processing-queue.service';
import { BookController } from 'src/presentation/controllers/book.controller';
import { BookDuplicateController } from 'src/presentation/controllers/book-duplicate.controller';
import { AuthModule } from 'src/modules/auth.module';
import { OpenLibraryGateway } from 'src/infrastructure/gateways/open-library.gateway';
import { GoogleBooksGateway } from 'src/infrastructure/gateways/google-books.gateway';
import { CompositeMetadataGateway } from 'src/infrastructure/gateways/composite-metadata.gateway';
import { CompositeSummaryGateway } from 'src/infrastructure/gateways/composite-summary.gateway';
import { FetchBookMetadataUseCase } from 'src/application/usecases/book/fetch-book-metadata-use-case.service';
import { FetchBookSummaryUseCase } from 'src/application/usecases/book/fetch-book-summary.usecase';
import { MetadataSchedulerService } from 'src/infrastructure/schedulers/metadata-scheduler.service';
import { GetBookManifestUseCase } from 'src/application/usecases/book/get-book-manifest.usecase';
import { GetBookContentUseCase } from 'src/application/usecases/book/get-book-content.usecase';
import { EpubManifestService } from 'src/infrastructure/services/epub-manifest.service';
import { EpubContentService } from 'src/infrastructure/services/epub-content.service';
import { EpubParserService } from 'src/infrastructure/parsers/epub-parser.service';
import { SettingsModule } from 'src/modules/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookEntity, BookDuplicateEntity, UserBookFavoriteEntity]),
    BullModule.registerQueue({ name: 'file-processing' }, { name: 'duplicate-scan' }),
    AuthModule,
    SettingsModule,
  ],
  providers: [
    // Repositories
    {
      provide: 'BookRepository',
      useClass: TypeOrmBookRepository,
    },
    {
      provide: 'BookDuplicateRepository',
      useClass: TypeOrmBookDuplicateRepository,
    },

    // Queue adapters
    {
      provide: 'DuplicateScanQueue',
      useClass: DuplicateScanQueueService,
    },
    {
      provide: 'FileProcessingQueue',
      useClass: FileProcessingQueueService,
    },

    // Use Cases
    CreateBookUseCase,
    DeleteBookUseCase,
    DownloadBookUseCase,
    GetBooksUseCase,
    GetFavoriteBooksUseCase,
    GetBookByIdUseCase,
    UpdateBookUseCase,
    AssignBookOwnerUseCase,
    ToggleBookFavoriteUseCase,
    FetchBookMetadataUseCase,
    FetchBookSummaryUseCase,
    ListDuplicatesUseCase,
    ResolveDuplicateUseCase,
    ScanDuplicatesUseCase,
    GetBookManifestUseCase,
    GetBookContentUseCase,

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

    // Publication services
    {
      provide: 'PublicationManifestService',
      useClass: EpubManifestService,
    },
    {
      provide: 'PublicationContentService',
      useClass: EpubContentService,
    },

    // Services
    {
      provide: 'ContentHashService',
      useClass: ContentHashService,
    },
    {
      provide: 'FileService',
      useClass: FileService,
    },

    // Schedulers
    MetadataSchedulerService,
    DuplicateScanSchedulerService,

    // Processors
    DuplicateScanProcessor,
  ],
  controllers: [BookDuplicateController, BookController],
  exports: ['BookRepository'],
})
export class BooksModule {}
