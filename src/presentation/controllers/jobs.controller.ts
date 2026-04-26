import { Controller, Get, Inject, Param, Query, Sse, UseGuards, UseInterceptors } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from 'src/presentation/guards/jwt-auth.guard';
import { MapResultInterceptor } from 'src/presentation/interceptors/map_result.interceptor';
import { IJobEventsService } from 'src/application/interfaces/job-events-service';
import { ListJobsUseCase } from 'src/application/usecases/jobs/list-jobs.usecase';
import { GetJobUseCase } from 'src/application/usecases/jobs/get-job.usecase';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
@UseInterceptors(MapResultInterceptor)
export class JobController {
  constructor(
    private readonly listJobsUseCase: ListJobsUseCase,
    private readonly getJobUseCase: GetJobUseCase,
    @Inject('JobEventsService') private readonly jobEventsService: IJobEventsService,
  ) {}

  @Sse('stream')
  @UseGuards(JwtAuthGuard)
  streamJobs(): Observable<MessageEvent> {
    return this.jobEventsService.getStream();
  }

  @Get()
  async listJobs(
    @Query('status') status?: string,
    @Query('queue') queue?: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.listJobsUseCase.execute({ status, queue, limit: Number(limit), offset: Number(offset) });
  }

  @Get(':id')
  async getJob(@Param('id') jobId: string) {
    return this.getJobUseCase.execute({ jobId });
  }
}
