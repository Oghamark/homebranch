import { Inject, Injectable } from '@nestjs/common';
import { IJobQueryService, JobInfo } from 'src/application/interfaces/job-query-service';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';

export interface GetJobRequest {
  jobId: string;
}

@Injectable()
export class GetJobUseCase implements UseCase<GetJobRequest, JobInfo | null> {
  constructor(@Inject('JobQueryService') private readonly jobQueryService: IJobQueryService) {}

  async execute({ jobId }: GetJobRequest): Promise<Result<JobInfo | null>> {
    const result = await this.jobQueryService.getJobById(jobId);
    return Result.ok(result);
  }
}
