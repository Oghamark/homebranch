import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IFileProcessingQueue, FileProcessingJobResult } from 'src/application/interfaces/file-processing-queue';

@Injectable()
export class FileProcessingQueueService implements IFileProcessingQueue {
  constructor(@InjectQueue('file-processing') private readonly fileProcessingQueue: Queue) {}

  async enqueueMetadataSync(
    bookId: string,
    fileName: string,
    filePath: string,
    options?: { jobId?: string },
  ): Promise<FileProcessingJobResult> {
    const job = await this.fileProcessingQueue.add(
      'sync-metadata',
      { bookId, fileName, filePath },
      { jobId: options?.jobId, removeOnComplete: 100, removeOnFail: 50 },
    );
    return { jobId: job.id };
  }
}
