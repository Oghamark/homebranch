import { Book } from 'src/domain/entities/book.entity';

export interface IPublicationManifestService {
  generateManifest(book: Book, baseUrl: string): object;
}
