export interface FileProcessingJobResult {
  jobId: string | undefined;
}

export interface IFileProcessingQueue {
  enqueueMetadataSync(
    bookId: string,
    fileName: string,
    filePath: string,
    options?: { jobId?: string },
  ): Promise<FileProcessingJobResult>;
}
