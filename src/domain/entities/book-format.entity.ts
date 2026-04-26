export enum BookFormatType {
  EPUB = 'EPUB',
  PDF = 'PDF',
}

export interface BookFormatProps {
  id: string;
  format: BookFormatType;
  fileName: string;
  fileMtime?: number;
  fileContentHash?: string;
  createdAt?: Date;
  title?: string;
  author?: string;
  genres?: string[];
  publishedYear?: number;
  coverImageFileName?: string;
  summary?: string;
  series?: string;
  seriesPosition?: number;
  isbn?: string;
  pageCount?: number;
  publisher?: string;
  language?: string;
}

export class BookFormat {
  public id: string;
  public format: BookFormatType;
  public fileName: string;
  public fileMtime?: number;
  public fileContentHash?: string;
  public createdAt?: Date;
  public title?: string;
  public author?: string;
  public genres?: string[];
  public publishedYear?: number;
  public coverImageFileName?: string;
  public summary?: string;
  public series?: string;
  public seriesPosition?: number;
  public isbn?: string;
  public pageCount?: number;
  public publisher?: string;
  public language?: string;

  constructor(props: BookFormatProps) {
    this.id = props.id;
    this.format = props.format;
    this.fileName = props.fileName;
    this.fileMtime = props.fileMtime;
    this.fileContentHash = props.fileContentHash;
    this.createdAt = props.createdAt;
    this.title = props.title;
    this.author = props.author;
    this.genres = props.genres;
    this.publishedYear = props.publishedYear;
    this.coverImageFileName = props.coverImageFileName;
    this.summary = props.summary;
    this.series = props.series;
    this.seriesPosition = props.seriesPosition;
    this.isbn = props.isbn;
    this.pageCount = props.pageCount;
    this.publisher = props.publisher;
    this.language = props.language;
  }
}
