import { BookFileMetadata, IBookMetadataParser } from 'src/application/interfaces/book-metadata-parser';

export interface IEpubMetadata extends BookFileMetadata {}

export interface IEpubParser extends IBookMetadataParser {}
