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

@Module({
  imports: [
    // Configuration first
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    ScheduleModule.forRoot(),

    HealthModule,

    // Database configuration
    TypeOrmConfigModule,

    // Feature modules
    BooksModule,
    BookShelvesModule,
    SavedPositionsModule,
    AuthorsModule,
    SettingsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
