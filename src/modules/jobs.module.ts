import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobController } from 'src/presentation/controllers/jobs.controller';
import { AuthModule } from 'src/modules/auth.module';
import { JobEventsService } from 'src/infrastructure/services/job-events.service';
import { JobQueryService } from 'src/infrastructure/services/job-query.service';
import { ListJobsUseCase } from 'src/application/usecases/jobs/list-jobs.usecase';
import { GetJobUseCase } from 'src/application/usecases/jobs/get-job.usecase';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'library-scan' }, { name: 'file-processing' }, { name: 'duplicate-scan' }),
    AuthModule,
  ],
  controllers: [JobController],
  providers: [
    {
      provide: 'JobEventsService',
      useClass: JobEventsService,
    },
    {
      provide: 'JobQueryService',
      useClass: JobQueryService,
    },
    ListJobsUseCase,
    GetJobUseCase,
  ],
})
export class JobsModule {}
