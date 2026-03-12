import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { BookEntity } from 'src/infrastructure/database/book.entity';
import { TypeOrmBookRepository } from 'src/infrastructure/repositories/book.repository';
import { ContentHashService } from 'src/infrastructure/services/content-hash.service';
import { EpubMetadataWriterService } from 'src/infrastructure/services/epub-metadata-writer.service';
import { FileWatcherService } from 'src/infrastructure/services/file-watcher.service';
import { LibraryEventsService } from 'src/infrastructure/services/library-events.service';
import { LibraryScanProcessor } from 'src/infrastructure/processors/library-scan.processor';
import { FileProcessingProcessor } from 'src/infrastructure/processors/file-processing.processor';
import { LegacyRenameService } from 'src/infrastructure/services/legacy-rename.service';
import { LibrarySyncController } from 'src/presentation/controllers/library-sync.controller';
import { EpubParserService } from 'src/infrastructure/parsers/epub-parser.service';
import { OpenLibraryGateway } from 'src/infrastructure/gateways/open-library.gateway';
import { GoogleBooksGateway } from 'src/infrastructure/gateways/google-books.gateway';
import { CompositeMetadataGateway } from 'src/infrastructure/gateways/composite-metadata.gateway';
import { AuthModule } from 'src/modules/auth.module';
import { SettingsModule } from 'src/modules/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookEntity]),
    BullModule.registerQueue({ name: 'library-scan' }, { name: 'file-processing' }),
    AuthModule,
    SettingsModule,
  ],
  providers: [
    { provide: 'BookRepository', useClass: TypeOrmBookRepository },
    { provide: 'ContentHashService', useClass: ContentHashService },
    { provide: 'EpubMetadataWriter', useClass: EpubMetadataWriterService },
    { provide: 'EpubParser', useClass: EpubParserService },
    { provide: 'OpenLibraryGateway', useClass: OpenLibraryGateway },
    { provide: 'GoogleBooksGateway', useClass: GoogleBooksGateway },
    { provide: 'MetadataGateway', useClass: CompositeMetadataGateway },
    LibraryEventsService,
    FileWatcherService,
    LibraryScanProcessor,
    FileProcessingProcessor,
    LegacyRenameService,
  ],
  controllers: [LibrarySyncController],
})
export class LibrarySyncModule {}
