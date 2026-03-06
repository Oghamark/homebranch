export interface IEpubMetadata {
  title?: string;
  author?: string;
  language?: string;
  publisher?: string;
  publishedYear?: number;
  isbn?: string;
  summary?: string;
  genres?: string[];
  series?: string;
  seriesPosition?: number;
  coverImageBuffer?: Buffer;
  coverImageMimeType?: string;
}

export interface IEpubParser {
  parse(filePath: string): Promise<IEpubMetadata>;
}
