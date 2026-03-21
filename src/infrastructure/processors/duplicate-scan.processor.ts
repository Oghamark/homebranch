import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { IBookDuplicateRepository } from 'src/application/interfaces/book-duplicate-repository';
import { IContentHashService } from 'src/application/interfaces/content-hash-service';
import { BookDuplicate } from 'src/domain/entities/book-duplicate.entity';
import { Book } from 'src/domain/entities/book.entity';

@Processor('duplicate-scan')
export class DuplicateScanProcessor extends WorkerHost {
  private readonly logger = new Logger(DuplicateScanProcessor.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('BookDuplicateRepository') private readonly duplicateRepository: IBookDuplicateRepository,
    @Inject('ContentHashService') private readonly contentHashService: IContentHashService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'scan-duplicates') {
      await this.scanForDuplicates(job);
    } else {
      this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async scanForDuplicates(job: Job): Promise<void> {
    this.logger.log('Starting library duplicate scan');
    await job.updateProgress(0);

    const booksResult = await this.bookRepository.findAllActive();
    if (!booksResult.isSuccess()) {
      this.logger.warn('Failed to fetch active books for duplicate scan');
      return;
    }

    const allBooks = booksResult.value;
    const uploadsDir = process.env.UPLOADS_DIRECTORY || './uploads';
    const booksDir = join(uploadsDir, 'books');

    // Recompute content hashes (spine-only) for all books, updating stale stored values.
    // This ensures books uploaded before the content-hash algorithm change are rehashed.
    await job.updateProgress(5);
    for (const book of allBooks) {
      const filePath = join(booksDir, book.fileName);
      try {
        const freshHash = await this.contentHashService.computeHash(filePath);
        if (freshHash !== book.fileContentHash) {
          await this.bookRepository.updateContentHash(book.id, freshHash);
          book.fileContentHash = freshHash;
        }
      } catch {
        // File may not be accessible; skip rehash for this book
      }
    }

    await job.updateProgress(10);

    // Group books by content hash — any group with 2+ books contains duplicates
    const byHash = new Map<string, Book[]>();
    for (const book of allBooks.filter((b) => b.fileContentHash)) {
      const hash = book.fileContentHash!;
      const group = byHash.get(hash) ?? [];
      group.push(book);
      byHash.set(hash, group);
    }

    const groups = [...byHash.values()].filter((g) => g.length >= 2);
    const totalGroups = groups.length;
    let flagged = 0;

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];

          // Check if already flagged (either direction)
          const existing = await this.duplicateRepository.findByBookIds(a.id, b.id);
          if (existing.isSuccess()) continue;

          const reverseExisting = await this.duplicateRepository.findByBookIds(b.id, a.id);
          if (reverseExisting.isSuccess()) continue;

          // Newer book is the suspect
          const [suspect, original] = a.createdAt! > b.createdAt! ? [a, b] : [b, a];
          const duplicate = new BookDuplicate(randomUUID(), suspect.id, original.id, new Date());
          await this.duplicateRepository.create(duplicate);
          flagged++;
          this.logger.log(
            `Potential duplicate flagged: "${suspect.title}" (${suspect.id}) vs "${original.title}" (${original.id})`,
          );
        }
      }

      const progress = totalGroups > 0 ? Math.round(10 + ((gi + 1) / totalGroups) * 90) : 100;
      await job.updateProgress(progress);
    }

    if (totalGroups === 0) {
      await job.updateProgress(100);
    }

    this.logger.log(`Duplicate scan complete. Flagged ${flagged} new potential duplicate(s).`);
  }
}
