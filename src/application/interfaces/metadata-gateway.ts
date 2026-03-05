import { Book } from 'src/domain/entities/book.entity';
import { Author } from 'src/domain/entities/author.entity';

export interface IMetadataGateway {
  enrichBook(book: Book): Promise<Book>;
  enrichAuthor(author: Author): Promise<Author>;
}
