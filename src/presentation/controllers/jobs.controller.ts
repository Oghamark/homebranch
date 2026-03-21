import { Controller, Get, Param, Query, Sse, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, JobState } from 'bullmq';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from 'src/infrastructure/guards/jwt-auth.guard';
import { MapResultInterceptor } from 'src/presentation/interceptors/map_result.interceptor';
import { Result } from 'src/core/result';
import { JobEventsService } from 'src/infrastructure/services/job-events.service';

export interface JobInfo {
  id: string | undefined;
  name: string;
  queue: string;
  status: string;
  progress: unknown;
  data: unknown;
  result: unknown;
  failedReason: string;
  createdAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
}

@Controller('jobs')
@UseGuards(JwtAuthGuard)
@UseInterceptors(MapResultInterceptor)
export class JobController {
  private readonly queues: Queue[];

  constructor(
    @InjectQueue('library-scan') private readonly libraryScanQueue: Queue,
    @InjectQueue('file-processing') private readonly fileProcessingQueue: Queue,
    @InjectQueue('duplicate-scan') private readonly duplicateScanQueue: Queue,
    private readonly jobEventsService: JobEventsService,
  ) {
    this.queues = [this.libraryScanQueue, this.fileProcessingQueue, this.duplicateScanQueue];
  }

  @Sse('stream')
  @UseGuards(JwtAuthGuard)
  streamJobs(): Observable<MessageEvent> {
    return this.jobEventsService.getStream();
  }

  @Get()
  async listJobs(
    @Query('status') status?: string,
    @Query('queue') queueName?: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    const targetQueues = queueName ? this.queues.filter((q) => q.name === queueName) : this.queues;

    const states: JobState[] = status ? [status as JobState] : ['active', 'waiting', 'completed', 'failed', 'delayed'];

    const allJobs: JobInfo[] = [];
    for (const queue of targetQueues) {
      const jobs = await queue.getJobs(states, offset, offset + limit - 1);
      for (const job of jobs) {
        const state = await job.getState();
        allJobs.push({
          id: job.id,
          name: job.name,
          queue: queue.name,
          status: state,
          progress: job.progress,
          data: job.data as unknown,
          result: job.returnvalue as unknown,
          failedReason: job.failedReason,
          createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
          processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
          finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        });
      }
    }

    // Sort by creation time, newest first
    allJobs.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return Result.ok({
      data: allJobs.slice(0, limit),
      total: allJobs.length,
      limit,
      offset,
    });
  }

  @Get(':id')
  async getJob(@Param('id') jobId: string) {
    for (const queue of this.queues) {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        return Result.ok({
          id: job.id,
          name: job.name,
          queue: queue.name,
          status: state,
          progress: job.progress,
          data: job.data as unknown,
          result: job.returnvalue as unknown,
          failedReason: job.failedReason,
          createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
          processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
          finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          attemptsMade: job.attemptsMade,
        });
      }
    }
    return Result.ok(null);
  }
}
