export class Book {
  constructor(
    public id: string,
    public title: string,
    public author: string,
    public fileName: string,
    public isFavorite: boolean,
    public genres: string[],
    public publishedYear?: number,
    public coverImageFileName?: string,
    public summary?: string,
    public uploadedByUserId?: string,
    public series?: string,
    public seriesPosition?: number,
    public isbn?: string,
    public pageCount?: number,
    public publisher?: string,
    public language?: string,
    public averageRating?: number,
    public ratingsCount?: number,
    public metadataFetchedAt?: Date,
  ) {}
}
