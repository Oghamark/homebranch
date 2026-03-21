import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmConfigModule } from './modules/typeorm.module';
import { BooksModule } from './modules/book.module';
import { BookShelvesModule } from './modules/book-shelf.module';
import { SavedPositionsModule } from './modules/saved-position.module';
import { HealthModule } from './modules/health.module';
import { AuthorsModule } from './modules/author.module';
import { SettingsModule } from './modules/settings.module';
import { OpdsModule } from './modules/opds.module';
import { QueueModule } from './modules/queue.module';
import { LibrarySyncModule } from './modules/library-sync.module';
import { JobsModule } from './modules/jobs.module';

@Module({
  imports: [
    // Configuration first
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    ScheduleModule.forRoot(),

    HealthModule,

    // Queue infrastructure
    QueueModule,

    // Database configuration
    TypeOrmConfigModule,

    // Feature modules
    BooksModule,
    BookShelvesModule,
    SavedPositionsModule,
    AuthorsModule,
    SettingsModule,
    OpdsModule,
    LibrarySyncModule,
    JobsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
