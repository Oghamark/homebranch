import { Inject, Injectable, Logger } from '@nestjs/common';
import { IDuplicateScanQueue } from 'src/application/interfaces/duplicate-scan-queue';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';

@Injectable()
export class ScanDuplicatesUseCase implements UseCase<void, void> {
  private readonly logger = new Logger(ScanDuplicatesUseCase.name);

  constructor(@Inject('DuplicateScanQueue') private readonly duplicateScanQueue: IDuplicateScanQueue) {}

  async execute(): Promise<Result<void>> {
    await this.duplicateScanQueue.enqueueScan();
    this.logger.log('Duplicate scan job enqueued');
    return Result.ok();
  }
}
