import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { IStorageService, STORAGE_SERVICE_TOKEN } from 'src/modules/storage/storage.interface';
import { permanentDeleteBook } from 'src/modules/book/persistence/book.persistence';

@Injectable()
export class TenantPurgeService {
  private readonly logger = new Logger(TenantPurgeService.name);

  constructor(
    @InjectRepository(BookEntity) private readonly books: Repository<BookEntity>,
    @InjectRepository(BookShelfEntity) private readonly shelves: Repository<BookShelfEntity>,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {}

  /** Deletes every book, stored file, cover and shelf owned by the user. Idempotent. */
  async purge(userId: string): Promise<{ books: number; shelves: number }> {
    const owned = await this.books.find({ where: { uploadedByUserId: userId }, select: { id: true } });
    for (const { id } of owned) {
      try {
        await permanentDeleteBook(this.books, id, this.storage);
      } catch (error) {
        this.logger.error(`Failed to purge book ${id} for user ${userId}: ${String(error)}`);
        throw error;
      }
    }
    const shelves = await this.shelves.delete({ createdByUserId: userId });
    return { books: owned.length, shelves: shelves.affected ?? 0 };
  }
}
