import { Inject, Injectable } from '@nestjs/common';
import { IFileProcessingQueue } from 'src/application/interfaces/file-processing-queue';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';

export interface TriggerBookMetadataSyncRequest {
  bookId: string;
}

@Injectable()
export class TriggerBookMetadataSyncUseCase
  implements UseCase<TriggerBookMetadataSyncRequest, { jobId: string | undefined }>
{
  constructor(@Inject('FileProcessingQueue') private readonly fileProcessingQueue: IFileProcessingQueue) {}

  async execute({ bookId }: TriggerBookMetadataSyncRequest): Promise<Result<{ jobId: string | undefined }>> {
    const result = await this.fileProcessingQueue.enqueueMetadataSync('', '', '', {
      jobId: `sync-${bookId}-manual`,
    });
    return Result.ok({ jobId: result.jobId });
  }
}
