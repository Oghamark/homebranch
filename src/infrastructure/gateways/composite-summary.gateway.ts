import { Inject, Injectable } from '@nestjs/common';
import { ISummaryGateway } from 'src/application/interfaces/summary-gateway';
import { Book } from 'src/domain/entities/book.entity';

@Injectable()
export class CompositeSummaryGateway implements ISummaryGateway {
  constructor(
    @Inject('OpenLibraryGateway') private readonly openLibraryGateway: ISummaryGateway,
    @Inject('GoogleBooksGateway') private readonly googleBooksGateway: ISummaryGateway,
  ) {}

  async fetchSummary(book: Book): Promise<string | null> {
    const openLibrarySummary = await this.openLibraryGateway.fetchSummary(book);
    if (openLibrarySummary) {
      return openLibrarySummary;
    }
    return this.googleBooksGateway.fetchSummary(book);
  }
}
