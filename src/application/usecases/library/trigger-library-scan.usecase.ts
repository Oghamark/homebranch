import { Inject, Injectable } from '@nestjs/common';
import { ILibraryScanQueue } from 'src/application/interfaces/library-scan-queue';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';

export interface TriggerLibraryScanRequest {
  booksDirectory: string;
}

@Injectable()
export class TriggerLibraryScanUseCase implements UseCase<TriggerLibraryScanRequest, { jobId: string | undefined }> {
  constructor(@Inject('LibraryScanQueue') private readonly libraryScanQueue: ILibraryScanQueue) {}

  async execute({ booksDirectory }: TriggerLibraryScanRequest): Promise<Result<{ jobId: string | undefined }>> {
    const result = await this.libraryScanQueue.enqueueScan(booksDirectory);
    return Result.ok({ jobId: result.jobId });
  }
}
