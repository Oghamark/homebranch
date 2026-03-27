import { Inject, Injectable } from '@nestjs/common';
import { IJobQueryService, JobListResult } from 'src/application/interfaces/job-query-service';
import { Result } from 'src/core/result';
import { UseCase } from 'src/core/usecase';

export interface ListJobsRequest {
  status?: string;
  queue?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ListJobsUseCase implements UseCase<ListJobsRequest, JobListResult> {
  constructor(@Inject('JobQueryService') private readonly jobQueryService: IJobQueryService) {}

  async execute({ status, queue, limit = 20, offset = 0 }: ListJobsRequest): Promise<Result<JobListResult>> {
    const result = await this.jobQueryService.listJobs(status, queue, limit, offset);
    return Result.ok(result);
  }
}
