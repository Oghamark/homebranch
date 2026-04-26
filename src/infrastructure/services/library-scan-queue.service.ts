import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ILibraryScanQueue, LibraryScanJobResult } from 'src/application/interfaces/library-scan-queue';

@Injectable()
export class LibraryScanQueueService implements ILibraryScanQueue {
  constructor(@InjectQueue('library-scan') private readonly libraryScanQueue: Queue) {}

  async enqueueScan(booksDirectory: string): Promise<LibraryScanJobResult> {
    const job = await this.libraryScanQueue.add(
      'scan-directory',
      { trigger: 'manual', booksDirectory },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
    return { jobId: job.id };
  }
}
