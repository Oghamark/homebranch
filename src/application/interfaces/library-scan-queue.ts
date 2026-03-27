export interface LibraryScanJobResult {
  jobId: string | undefined;
}

export interface ILibraryScanQueue {
  enqueueScan(booksDirectory: string): Promise<LibraryScanJobResult>;
}
