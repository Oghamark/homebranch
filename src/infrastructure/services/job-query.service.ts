import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, JobState } from 'bullmq';
import { IJobQueryService, JobInfo, JobListResult } from 'src/application/interfaces/job-query-service';

@Injectable()
export class JobQueryService implements IJobQueryService {
  private readonly queues: Queue[];

  constructor(
    @InjectQueue('library-scan') libraryScanQueue: Queue,
    @InjectQueue('file-processing') fileProcessingQueue: Queue,
    @InjectQueue('duplicate-scan') duplicateScanQueue: Queue,
  ) {
    this.queues = [libraryScanQueue, fileProcessingQueue, duplicateScanQueue];
  }

  async listJobs(status?: string, queue?: string, limit = 20, offset = 0): Promise<JobListResult> {
    const targetQueues = queue ? this.queues.filter((q) => q.name === queue) : this.queues;
    const states: JobState[] = status ? [status as JobState] : ['active', 'waiting', 'completed', 'failed', 'delayed'];

    const allJobs: JobInfo[] = [];
    for (const q of targetQueues) {
      const jobs = await q.getJobs(states, offset, offset + limit - 1);
      for (const job of jobs) {
        const state = await job.getState();
        allJobs.push({
          id: job.id,
          name: job.name,
          queue: q.name,
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

    allJobs.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return {
      data: allJobs.slice(0, limit),
      total: allJobs.length,
      limit,
      offset,
    };
  }

  async getJobById(jobId: string): Promise<JobInfo | null> {
    for (const q of this.queues) {
      const job = await q.getJob(jobId);
      if (job) {
        const state = await job.getState();
        return {
          id: job.id,
          name: job.name,
          queue: q.name,
          status: state,
          progress: job.progress,
          data: job.data as unknown,
          result: job.returnvalue as unknown,
          failedReason: job.failedReason,
          createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
          processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
          finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          attemptsMade: job.attemptsMade,
        };
      }
    }
    return null;
  }
}
