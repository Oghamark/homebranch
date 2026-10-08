import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';

const DEFAULT_QUOTA_BYTES = 5 * 1024 ** 3;

@Injectable()
export class StorageQuotaService {
  constructor(@InjectRepository(BookFormatEntity) private readonly formats: Repository<BookFormatEntity>) {}

  get quotaBytes(): number {
    const configured = Number(process.env.STORAGE_QUOTA_BYTES);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_QUOTA_BYTES;
  }

  async getUsedBytes(userId: string): Promise<number> {
    const row = await this.formats
      .createQueryBuilder('format')
      .innerJoin('format.book', 'book')
      .where('book.uploadedByUserId = :userId', { userId })
      .andWhere('book.deletedAt IS NULL')
      .select('COALESCE(SUM(format.fileSize), 0)', 'total')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  async getUsage(userId: string): Promise<{ usedBytes: number; quotaBytes: number }> {
    return { usedBytes: await this.getUsedBytes(userId), quotaBytes: this.quotaBytes };
  }

  async assertCanStore(userId: string, incomingBytes: number): Promise<void> {
    const used = await this.getUsedBytes(userId);
    if (used + incomingBytes > this.quotaBytes) {
      throw new PayloadTooLargeException('Storage quota exceeded. Remove books or upgrade your plan to upload more.');
    }
  }
}
