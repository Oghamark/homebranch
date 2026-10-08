import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { StorageModule } from 'src/modules/storage/storage.module';
import { TenantPurgeController } from './tenant-purge.controller';
import { TenantPurgeService } from './tenant-purge.service';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { EntitlementService } from './entitlement.service';
import { StorageQuotaService } from './storage-quota.service';
import { StorageUsageController } from './storage-usage.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([BookFormatEntity, BookEntity, BookShelfEntity]), StorageModule],
  controllers: [StorageUsageController, TenantPurgeController],
  providers: [EntitlementService, StorageQuotaService, TenantPurgeService],
  exports: [EntitlementService, StorageQuotaService],
})
export class CloudModule {}
