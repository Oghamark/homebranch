import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IDuplicateScanQueue } from 'src/application/interfaces/duplicate-scan-queue';

@Injectable()
export class DuplicateScanQueueService implements IDuplicateScanQueue {
  constructor(@InjectQueue('duplicate-scan') private readonly scanQueue: Queue) {}

  async enqueueScan(): Promise<void> {
    await this.scanQueue.add('scan-duplicates', {});
  }
}
