import { Inject, Injectable } from '@nestjs/common';
import { IMetadataGateway } from 'src/application/interfaces/metadata-gateway';
import { Book } from 'src/domain/entities/book.entity';
import { Author } from 'src/domain/entities/author.entity';

@Injectable()
export class CompositeMetadataGateway implements IMetadataGateway {
  constructor(
    @Inject('OpenLibraryGateway') private readonly openLibraryGateway: IMetadataGateway,
    @Inject('GoogleBooksGateway') private readonly googleBooksGateway: IMetadataGateway,
  ) {}

  async enrichBook(book: Book): Promise<Book> {
    book = await this.openLibraryGateway.enrichBook(book);
    book = await this.googleBooksGateway.enrichBook(book);
    return book;
  }

  async enrichAuthor(author: Author): Promise<Author> {
    return this.openLibraryGateway.enrichAuthor(author);
  }
}
