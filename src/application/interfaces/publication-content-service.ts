import { Book } from 'src/domain/entities/book.entity';

export interface PublicationContentEntry {
  data: Buffer;
  mediaType: string;
}

export interface IPublicationContentService {
  getContent(book: Book, entryPath: string): PublicationContentEntry | null;
}
