import { Book } from 'src/domain/entities/book.entity';

export interface ISummaryGateway {
  fetchSummary(book: Book): Promise<string | null>;
}
