import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { IBookRepository } from 'src/application/interfaces/book-repository';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';

const BATCH_SIZE = 20;
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const RATE_LIMIT_DELAY_MS = 400;

@Injectable()
export class MetadataSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MetadataSchedulerService.name);

  constructor(
    @Inject('BookRepository') private readonly bookRepository: IBookRepository,
    @Inject('MetadataGateway') private readonly metadataGateway: IMetadataGateway,
  ) {}

  async onModuleInit() {
    this.logger.log('MetadataSchedulerService initialized');
    await this.enrichBooksWithMissingMetadata();
  }

  @Interval(INTERVAL_MS)
  async enrichBooksWithMissingMetadata(): Promise<void> {
    const findResult = await this.bookRepository.findBooksWithoutMetadata(BATCH_SIZE);
    if (!findResult.isSuccess()) {
      this.logger.warn('Failed to fetch books without metadata');
      return;
    }

    const books = findResult.value;
    if (books.length === 0) {
      return;
    }

    this.logger.log(`Enriching metadata for ${books.length} book(s)`);

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      try {
        const enriched = await this.metadataGateway.enrichBook(book);
        await this.bookRepository.update(enriched.id, enriched);
      } catch (error) {
        this.logger.warn(`Metadata enrichment failed for book "${book.title}": ${String(error)}`);
      }

      if (i < books.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    this.logger.log(`Metadata enrichment complete for ${books.length} book(s)`);
  }
}
