import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Result } from 'src/core/result';

@Injectable()
export class ScanDuplicatesUseCase {
  private readonly logger = new Logger(ScanDuplicatesUseCase.name);

  constructor(@InjectQueue('duplicate-scan') private readonly scanQueue: Queue) {}

  async execute(): Promise<Result<void>> {
    await this.scanQueue.add('scan-duplicates', {});
    this.logger.log('Duplicate scan job enqueued');
    return Result.ok();
  }
}
