import { Inject, Injectable, Optional } from '@nestjs/common';
import { BookFileMetadata, IBookMetadataParser } from 'src/application/interfaces/book-metadata-parser';
import { IEpubMetadataWriter } from 'src/application/interfaces/epub-metadata-writer';
import { IEpubParser } from 'src/application/interfaces/epub-parser';
import { IPdfParser } from 'src/application/interfaces/pdf-parser';
import { BookFormatType } from 'src/domain/entities/book-format.entity';
import { supportsBookFormatMetadataWrite } from 'src/domain/services/book-format';
import { SyncableMetadata } from 'src/domain/value-objects/syncable-metadata';

@Injectable()
export class BookFormatProcessingService {
  private readonly parsers: Record<BookFormatType, IBookMetadataParser>;
  private readonly metadataWriters: Partial<Record<BookFormatType, IEpubMetadataWriter>>;

  constructor(
    @Inject('EpubParser') epubParser: IEpubParser,
    @Inject('PdfParser') pdfParser: IPdfParser,
    @Optional() @Inject('EpubMetadataWriter') epubMetadataWriter?: IEpubMetadataWriter,
  ) {
    this.parsers = {
      [BookFormatType.EPUB]: epubParser,
      [BookFormatType.PDF]: pdfParser,
    };
    this.metadataWriters = {
      [BookFormatType.EPUB]: epubMetadataWriter,
    };
  }

  async parseMetadata(filePath: string, format: BookFormatType): Promise<BookFileMetadata> {
    const parser = this.parsers[format];
    return parser ? parser.parse(filePath) : {};
  }

  canWriteMetadata(format: BookFormatType): boolean {
    return supportsBookFormatMetadataWrite(format) && Boolean(this.metadataWriters[format]);
  }

  async writeMetadata(filePath: string, format: BookFormatType, metadata: SyncableMetadata): Promise<boolean> {
    const writer = this.metadataWriters[format];
    if (!writer) {
      return false;
    }
    await writer.writeMetadata(filePath, metadata);
    return true;
  }
}
